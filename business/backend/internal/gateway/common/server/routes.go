package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/liveshop-platform/contracts/modulemanifest"
	"github.com/lvtuopen-ai/kernel-go/modulesession"
	"github.com/lvtuopen-ai/kernel-go/principal"
)

// identityBrowserRoutes is the only browser control path. Identity owns access
// authentication, effective authorization, contribution filtering and scoped
// Module Capability issuance. Platform must never become an alternate browser
// runtime or IAM path.
var identityBrowserRoutes = map[string]string{
	"/auth/login":                 http.MethodPost,
	"/auth/guest":                 http.MethodPost,
	"/auth/refresh":               http.MethodPost,
	"/auth/logout":                http.MethodPost,
	"/auth/me":                    http.MethodGet,
	"/auth/context/switch":        http.MethodPost,
	"/runtime/v1/contributions":   http.MethodGet,
	"/runtime/v1/module-sessions": http.MethodPost,
	"/runtime/v1/iam/me":          http.MethodGet,
	"/runtime/v1/module-catalog":  http.MethodGet,
}

// BrowserRoutes exposes the allowlist so the architecture check can prove the
// declared policy and the executed policy are the same list.
func BrowserRoutes() map[string]string {
	published := make(map[string]string, len(identityBrowserRoutes))
	for path, method := range identityBrowserRoutes {
		published[path] = method
	}
	return published
}

func (g *Gateway) identity(w http.ResponseWriter, r *http.Request) {
	stripUntrustedContext(r.Header)
	proxyBrowserRoute(w, r, identityBrowserRoutes, g.identityProxy, "identity")
}

func proxyBrowserRoute(w http.ResponseWriter, r *http.Request, routes map[string]string, proxy http.Handler, service string) {
	method, exists := routes[r.URL.Path]
	if !exists {
		write(w, http.StatusNotFound, map[string]any{"code": 40400, "message": service + " browser route is not exposed"})
		return
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		write(w, http.StatusMethodNotAllowed, map[string]any{"code": 40500, "message": "method is not allowed"})
		return
	}
	if !validSurface(r.Header.Get("X-Liveshop-Surface")) {
		write(w, http.StatusBadRequest, map[string]any{"code": 40000, "message": "valid surface header is required"})
		return
	}
	if proxy == nil {
		write(w, http.StatusServiceUnavailable, map[string]any{"code": 50300, "message": service + " service is unavailable"})
		return
	}
	proxy.ServeHTTP(w, r)
}

// module forwards a request to the module that owns the matching active route,
// after the presented Identity-issued Module Capability proves it authorizes
// this Registry revision, surface, method and path.
func (g *Gateway) module(w http.ResponseWriter, r *http.Request) {
	stripUntrustedContext(r.Header)
	if strings.HasPrefix(r.URL.Path, "/internal/") {
		write(w, http.StatusNotFound, map[string]any{"code": 40400, "message": "internal route is not browser accessible"})
		return
	}
	current := g.current.Load()
	surface := r.Header.Get("X-Liveshop-Surface")
	if surface == "" {
		if current.revision != 0 && g.snapshotFresh(current, time.Now()) {
			if candidate, operation := matchUniquePublic(current.routes, r.Method, r.URL.Path); operation != nil {
				r.Header.Del("Authorization")
				r.Header.Set("X-Liveshop-Module-ID", candidate.ModuleID)
				candidate.proxy.ServeHTTP(w, r)
				return
			}
		}
		write(w, http.StatusBadRequest, map[string]any{"code": 40000, "message": "surface header is required"})
		return
	}
	if current.revision == 0 || !g.snapshotFresh(current, time.Now()) {
		write(w, http.StatusServiceUnavailable, map[string]any{"code": 50300, "message": "module route snapshot is unavailable or stale"})
		return
	}
	for _, candidate := range current.routes {
		if candidate.Surface != surface || !pathMatches(r.URL.Path, candidate.Prefix) {
			continue
		}
		operation, pathKnown := matchOperation(candidate.Operations, r.Method, r.URL.Path)
		if operation == nil {
			if pathKnown {
				write(w, http.StatusMethodNotAllowed, map[string]any{"code": 40500, "message": "method is not allowed"})
				return
			}
			write(w, http.StatusNotFound, map[string]any{"code": 40400, "message": "module operation is not exposed"})
			return
		}
		if operation.Authentication == "public" {
			r.Header.Del("Authorization")
			r.Header.Set("X-Liveshop-Module-ID", candidate.ModuleID)
			candidate.proxy.ServeHTTP(w, r)
			return
		}
		token, ok := modulesession.Bearer(r.Header.Get("Authorization"))
		if !ok || g.capabilities == nil {
			write(w, http.StatusUnauthorized, map[string]any{"code": 40100, "message": "module capability is required"})
			return
		}
		claims, err := g.capabilities.VerifyAudience(token, "liveshop-module:"+candidate.ModuleID)
		if err != nil || claims.ModuleID != candidate.ModuleID || claims.Surface != surface ||
			claims.RegistryRevision != current.revision ||
			claims.AuthorizationRevision == 0 || claims.EntitlementRevision == 0 ||
			!modulesession.RealmAllowsSurface(claims.Realm, surface) ||
			!modulesession.AllowsRequest(claims, r.Method, r.URL.Path) {
			write(w, http.StatusForbidden, map[string]any{"code": 40300, "message": "module capability does not authorize this route revision"})
			return
		}
		if operation.Authentication == "guest-session" {
			if claims.PrincipalType != principal.TypeGuest && claims.PrincipalType != principal.TypeCustomer {
				write(w, http.StatusForbidden, map[string]any{"code": 40300, "message": "shopper session is required"})
				return
			}
		} else if claims.PrincipalType == principal.TypeGuest {
			write(w, http.StatusForbidden, map[string]any{"code": 40301, "message": "login is required"})
			return
		}
		r.Header.Set("X-Liveshop-Module-ID", candidate.ModuleID)
		candidate.proxy.ServeHTTP(w, r)
		return
	}
	write(w, http.StatusNotFound, map[string]any{"code": 40400, "message": "no active module route"})
}

func matchOperation(operations []modulemanifest.ActiveRouteOperation, method, path string) (*modulemanifest.ActiveRouteOperation, bool) {
	pathKnown := false
	for index := range operations {
		operation := &operations[index]
		if !operationPathMatches(path, operation.Path) {
			continue
		}
		pathKnown = true
		if operation.Method == method {
			return operation, true
		}
	}
	return nil, pathKnown
}

// matchUniquePublic lets a browser open a declared public object URL without
// X-Liveshop-Surface. Ambiguous public paths stay closed so a missing surface
// cannot choose among modules.
func matchUniquePublic(routes []route, method, path string) (*route, *modulemanifest.ActiveRouteOperation) {
	var found *route
	var matched *modulemanifest.ActiveRouteOperation
	for index := range routes {
		operation, _ := matchOperation(routes[index].Operations, method, path)
		if operation == nil || operation.Authentication != "public" {
			continue
		}
		if found != nil {
			return nil, nil
		}
		found = &routes[index]
		matched = operation
	}
	return found, matched
}

// operationPathMatches matches a manifest path template exactly. A template
// parameter consumes one non-empty segment and can never widen the operation
// to a deeper path.
func operationPathMatches(path, template string) bool {
	pathSegments := splitPath(path)
	templateSegments := splitPath(template)
	if len(pathSegments) != len(templateSegments) {
		return false
	}
	for index, segment := range templateSegments {
		if strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}") && len(segment) > 2 {
			if pathSegments[index] == "" {
				return false
			}
			continue
		}
		if pathSegments[index] != segment {
			return false
		}
	}
	return true
}

func splitPath(value string) []string {
	if value == "/" {
		return nil
	}
	return strings.Split(strings.Trim(value, "/"), "/")
}

// validSurface reads the surface vocabulary from kernel principal rather than
// keeping a second list here, so a surface can never be routable at the edge
// without also being known to the realm reach rule.
func validSurface(surface string) bool {
	_, known := principal.ParseSurface(surface)
	return known
}

// pathMatches requires the prefix to end on a segment boundary so /shop/catalog
// never captures /shop/catalogue.
func pathMatches(path, prefix string) bool {
	prefix = strings.TrimRight(prefix, "/")
	return path == prefix || strings.HasPrefix(path, prefix+"/")
}
