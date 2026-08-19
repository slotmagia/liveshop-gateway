package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"reflect"
	"strings"
	"time"

	"github.com/liveshop-platform/contracts/modulemanifest"
	"github.com/lvtuopen-ai/kernel-go/logctx"
)

// snapshot is the active route table. It is replaced atomically and never
// mutated, so an in-flight request always sees one consistent generation.
type snapshot struct {
	revision uint64
	routes   []route
	loadedAt time.Time
}

type route struct {
	modulemanifest.ActiveRoute
	proxy *httputil.ReverseProxy
}

func (g *Gateway) refreshLoop(ctx context.Context) {
	if g.refreshInterval <= 0 {
		logctx.FromContext(ctx).Warn("route refresh disabled", "reason", "no refresh interval configured")
		return
	}
	ticker := time.NewTicker(g.refreshInterval)
	defer ticker.Stop()
	for {
		g.refresh(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// refresh replaces the snapshot only with a strictly newer, non-empty and
// fully compilable one. Every other outcome keeps the last good snapshot, so a
// Registry outage degrades into staleness rather than into an outage here.
func (g *Gateway) refresh(ctx context.Context) {
	received, ok := g.fetchRoutes(ctx)
	if !ok {
		return
	}
	compiled, ok := compileRoutes(ctx, received.Routes)
	if !ok {
		return
	}
	for {
		current := g.current.Load()
		if received.Revision < current.revision {
			logctx.FromContext(ctx).Warn("route refresh is stale; retaining last snapshot", "current_revision", current.revision, "received_revision", received.Revision)
			return
		}
		if received.Revision == current.revision {
			if !routesEquivalent(current.routes, compiled) {
				logctx.FromContext(ctx).Warn("route refresh changed content without a new revision; retaining last snapshot", "revision", current.revision)
				return
			}
			next := &snapshot{revision: current.revision, routes: current.routes, loadedAt: time.Now()}
			if g.current.CompareAndSwap(current, next) {
				return
			}
			continue
		}
		if len(compiled) == 0 && len(current.routes) > 0 {
			logctx.FromContext(ctx).Warn("route refresh is empty; retaining last snapshot", "current_revision", current.revision, "received_revision", received.Revision)
			return
		}
		next := &snapshot{revision: received.Revision, routes: compiled, loadedAt: time.Now()}
		if g.current.CompareAndSwap(current, next) {
			return
		}
	}
}

func routesEquivalent(left, right []route) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if !reflect.DeepEqual(left[index].ActiveRoute, right[index].ActiveRoute) {
			return false
		}
	}
	return true
}

type routeSnapshotResponse struct {
	Revision uint64
	Routes   []modulemanifest.ActiveRoute
}

func (g *Gateway) fetchRoutes(ctx context.Context) (routeSnapshotResponse, bool) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, g.registryURL+"/internal/v1/module-registry/routes", nil)
	if err != nil {
		return routeSnapshotResponse{}, false
	}
	if g.workload == nil {
		logctx.FromContext(ctx).Warn("route refresh skipped", "reason", "workload identity issuer is not configured")
		return routeSnapshotResponse{}, false
	}
	workloadToken, err := g.workload.Sign(time.Minute)
	if err != nil {
		logctx.FromContext(ctx).Warn("route refresh identity failed", "error", err)
		return routeSnapshotResponse{}, false
	}
	request.Header.Set("Authorization", "Bearer "+workloadToken)
	response, err := g.client.Do(request)
	if err != nil {
		logctx.FromContext(ctx).Warn("route refresh failed; retaining last snapshot", "error", err)
		return routeSnapshotResponse{}, false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		logctx.FromContext(ctx).Warn("route refresh returned unexpected status", "status", response.StatusCode)
		return routeSnapshotResponse{}, false
	}
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Revision uint64                       `json:"revision"`
			Routes   []modulemanifest.ActiveRoute `json:"routes"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil || envelope.Code != 0 {
		logctx.FromContext(ctx).Warn("route snapshot decode failed", "error", err)
		return routeSnapshotResponse{}, false
	}
	return routeSnapshotResponse{Revision: envelope.Data.Revision, Routes: envelope.Data.Routes}, true
}

// compileRoutes rejects the whole snapshot when any origin is unusable, rather
// than publishing a partially routable table.
func compileRoutes(ctx context.Context, received []modulemanifest.ActiveRoute) ([]route, bool) {
	compiled := make([]route, 0, len(received))
	for _, item := range received {
		if item.Surface == "internal" {
			continue
		}
		origin, err := url.Parse(item.Origin)
		if err != nil || origin.Scheme == "" || origin.Host == "" {
			logctx.FromContext(ctx).Warn("invalid module origin", "module_id", item.ModuleID)
			return nil, false
		}
		if len(item.Operations) == 0 || !validRouteOperations(item) {
			logctx.FromContext(ctx).Warn("invalid or empty module operations", "module_id", item.ModuleID, "prefix", item.Prefix)
			return nil, false
		}
		compiled = append(compiled, route{ActiveRoute: item, proxy: newModuleProxy(origin, item.ModuleID)})
	}
	return compiled, true
}

func validRouteOperations(item modulemanifest.ActiveRoute) bool {
	seen := make(map[string]struct{}, len(item.Operations))
	for _, operation := range item.Operations {
		shape, validTemplate := operationTemplateShape(operation.Path)
		if !validOperationMethod(operation.Method) || !validOperationAuthentication(operation.Authentication) ||
			!strings.HasPrefix(operation.Path, "/") || !pathMatches(operation.Path, item.Prefix) || !validTemplate {
			return false
		}
		key := operation.Method + " " + shape
		if _, exists := seen[key]; exists {
			return false
		}
		seen[key] = struct{}{}
	}
	return true
}

func operationTemplateShape(path string) (string, bool) {
	segments := splitPath(path)
	for index, segment := range segments {
		hasOpening := strings.Contains(segment, "{")
		hasClosing := strings.Contains(segment, "}")
		if !hasOpening && !hasClosing {
			continue
		}
		if !strings.HasPrefix(segment, "{") || !strings.HasSuffix(segment, "}") || len(segment) <= 2 || strings.Count(segment, "{") != 1 || strings.Count(segment, "}") != 1 {
			return "", false
		}
		segments[index] = "{}"
	}
	return "/" + strings.Join(segments, "/"), true
}

func validOperationMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func validOperationAuthentication(authentication string) bool {
	switch authentication {
	case "public", "guest-session", "module-session":
		return true
	default:
		return false
	}
}
