// Package server is the sole HTTP composition root for the Gateway data plane.
// It owns no business state: every routing decision comes from Platform's
// internal Registry snapshot, and every browser authorization decision from
// an Identity-issued Module Capability.
package server

import (
	"context"
	"net/http"
	"net/http/httputil"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/lvtuopen-ai/kernel-go/lifecycle"
	"github.com/lvtuopen-ai/kernel-go/modulesession"
	"github.com/lvtuopen-ai/kernel-go/requestmeta"
	"github.com/lvtuopen-ai/kernel-go/workloadidentity"
)

// Config is what the data plane needs from the process. The composition root
// supplies it from validated configuration; nothing here reads the environment.
type Config struct {
	IdentityURL         string
	PlatformRegistryURL string
	Workload            *workloadidentity.Issuer
	Capabilities        *modulesession.Verifier
	SurfaceOrigins      map[string][]string
	RefreshInterval     time.Duration
	RefreshTimeout      time.Duration
	MaxStaleness        time.Duration
}

type Gateway struct {
	registryURL     string
	workload        *workloadidentity.Issuer
	client          *http.Client
	identityProxy   *httputil.ReverseProxy
	current         atomic.Pointer[snapshot]
	capabilities    *modulesession.Verifier
	originSurfaces  map[string]string
	refreshInterval time.Duration
	maxStaleness    time.Duration
	handlerOnce     sync.Once
	handler         http.Handler
}

func New(config Config) *Gateway {
	origins := make(map[string]string)
	for surface, configured := range config.SurfaceOrigins {
		for _, origin := range configured {
			if origin = strings.TrimSpace(origin); origin != "" {
				origins[origin] = surface
			}
		}
	}
	registryURL := strings.TrimRight(config.PlatformRegistryURL, "/")
	client := &http.Client{}
	if config.RefreshTimeout > 0 {
		client.Timeout = config.RefreshTimeout
	}
	g := &Gateway{
		registryURL:     registryURL,
		workload:        config.Workload,
		client:          client,
		identityProxy:   newIdentityProxy(config.IdentityURL),
		capabilities:    config.Capabilities,
		originSurfaces:  origins,
		refreshInterval: config.RefreshInterval,
		maxStaleness:    config.MaxStaleness,
	}
	g.current.Store(&snapshot{revision: 0, routes: []route{}, loadedAt: time.Now()})
	return g
}

func (g *Gateway) Run(ctx context.Context, addr string) error {
	go g.refreshLoop(ctx)
	server := &http.Server{
		Addr:              addr,
		Handler:           g.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	return lifecycle.RunHTTP(ctx, server, 10*time.Second)
}

// Handler mounts the two traffic classes this data plane serves: Identity's
// explicit browser bootstrap allowlist, and module traffic resolved against
// Platform's internal route snapshot. Platform has no browser proxy here.
func (g *Gateway) Handler() http.Handler {
	g.handlerOnce.Do(func() {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /health", g.health)
		mux.HandleFunc("GET /readyz", g.ready)
		mux.HandleFunc("/auth/", g.identity)
		mux.HandleFunc("/runtime/v1/", g.identity)
		mux.Handle("/", http.HandlerFunc(g.module))
		g.handler = requestmeta.Middleware(g.cors(mux))
	})
	return g.handler
}

// ready reports whether the Gateway has compiled at least one active Registry
// route. A listening process with revision zero is deliberately not ready: it
// must not receive browser traffic before the Registry data plane is usable.
func (g *Gateway) ready(w http.ResponseWriter, _ *http.Request) {
	current := g.current.Load()
	if current.revision == 0 || len(current.routes) == 0 || !g.snapshotFresh(current, time.Now()) {
		write(w, http.StatusServiceUnavailable, map[string]any{
			"status":   "not_ready",
			"revision": current.revision,
			"routes":   len(current.routes),
			"loadedAt": current.loadedAt,
		})
		return
	}
	write(w, http.StatusOK, map[string]any{
		"status":   "ready",
		"revision": current.revision,
		"routes":   len(current.routes),
	})
}

func (g *Gateway) snapshotFresh(current *snapshot, now time.Time) bool {
	return g.maxStaleness > 0 && !current.loadedAt.IsZero() && now.Sub(current.loadedAt) <= g.maxStaleness
}

// ServeHTTP resolves a request against the active module route snapshot.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) { g.module(w, r) }

func (g *Gateway) health(w http.ResponseWriter, _ *http.Request) {
	current := g.current.Load()
	write(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"revision": current.revision,
		"routes":   len(current.routes),
		"loadedAt": current.loadedAt,
	})
}
