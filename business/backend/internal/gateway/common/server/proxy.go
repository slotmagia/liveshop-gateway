package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/lvtuopen-ai/kernel-go/logctx"
)

func newIdentityProxy(identityURL string) *httputil.ReverseProxy {
	origin, err := url.Parse(identityURL)
	if err != nil || origin.Scheme == "" || origin.Host == "" {
		return nil
	}
	return newProxy(origin, func(w http.ResponseWriter, request *http.Request, err error) {
		logctx.FromContext(request.Context()).Warn("identity proxy failed", "error", err)
		write(w, http.StatusBadGateway, map[string]any{"code": 50200, "message": "identity service is unavailable"})
	})
}

func newModuleProxy(origin *url.URL, moduleID string) *httputil.ReverseProxy {
	return newProxy(origin, func(w http.ResponseWriter, request *http.Request, err error) {
		logctx.FromContext(request.Context()).Warn("module proxy failed", "module_id", moduleID, "error", err)
		write(w, http.StatusBadGateway, map[string]any{"code": 50200, "message": "module service is unavailable"})
	})
}

// newProxy strips the browser origin on the way out and the upstream CORS
// headers on the way back: Gateway is the single CORS boundary, so an upstream
// must never make a second, potentially conflicting browser-origin decision.
func newProxy(origin *url.URL, onError func(http.ResponseWriter, *http.Request, error)) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(origin)
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		director(request)
		request.Header.Del("Origin")
	}
	proxy.ModifyResponse = stripUpstreamCORS
	proxy.ErrorHandler = onError
	return proxy
}

// stripUntrustedContext removes every browser-controlled header that could be
// mistaken for an authenticated principal or commercial scope. The signed
// Access Identity and Module Capability are the only trusted context carriers.
func stripUntrustedContext(header http.Header) {
	// Reserve the whole X-Liveshop-* namespace for trusted edge context, with
	// Surface as the sole browser input because it is independently bound to
	// Origin and verified against signed claims. This also fails closed for new
	// revision/role/scope headers added in the future.
	for name := range header {
		if strings.HasPrefix(strings.ToLower(name), "x-liveshop-") && !strings.EqualFold(name, "X-Liveshop-Surface") {
			header.Del(name)
		}
	}
	for _, name := range []string{
		"X-App-Id", "X-Merchant-Id", "X-Shop-Id", "X-Commercial-Id", "X-Staff-Id",
		"X-User-Id", "X-Tenant-Id", "X-Role", "X-Roles",
	} {
		header.Del(name)
	}
}

func stripUpstreamCORS(response *http.Response) error {
	response.Header.Del("Access-Control-Allow-Origin")
	response.Header.Del("Access-Control-Allow-Headers")
	response.Header.Del("Access-Control-Allow-Methods")
	response.Header.Del("Access-Control-Allow-Credentials")
	return nil
}
