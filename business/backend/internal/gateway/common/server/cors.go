package server

import (
	"net/http"
	"strings"
)

// cors is the browser boundary of the whole platform. An origin that is not
// configured is rejected here and never reaches Platform or a module.
func (g *Gateway) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			configuredSurface, ok := g.originSurfaces[origin]
			if !ok {
				write(w, http.StatusForbidden, map[string]any{"code": 40300, "message": "origin is not allowed"})
				return
			}
			// The browser does not expose custom header values on its generated
			// preflight. Bind the preflight by the origin's single configured
			// surface and, for module paths, by the first URL segment. The actual
			// request is always checked against X-Liveshop-Surface below.
			if r.Method == http.MethodOptions {
				if pathSurface := modulePathSurface(r.URL.Path); pathSurface != "" && pathSurface != configuredSurface {
					write(w, http.StatusForbidden, map[string]any{"code": 40300, "message": "origin is not allowed for route surface"})
					return
				}
			} else if r.Header.Get("X-Liveshop-Surface") != configuredSurface {
				write(w, http.StatusForbidden, map[string]any{"code": 40300, "message": "origin is not allowed for requested surface"})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Liveshop-Surface,Idempotency-Key,X-Locale")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func modulePathSurface(path string) string {
	trimmed := strings.TrimPrefix(path, "/")
	first, _, _ := strings.Cut(trimmed, "/")
	if validSurface(first) {
		return first
	}
	return ""
}
