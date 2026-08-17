package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/liveshop-platform/contracts/modulemanifest"
	"github.com/lvtuopen-ai/kernel-go/modulesession"
	"github.com/lvtuopen-ai/kernel-go/principal"
	"github.com/lvtuopen-ai/kernel-go/workloadidentity"
)

func TestIdentityBrowserTrafficUsesExplicitGatewayRoutes(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/auth/login" || request.Header.Get("X-Liveshop-Surface") != "admin" {
			t.Fatalf("unexpected identity request: %s surface=%s", request.URL.Path, request.Header.Get("X-Liveshop-Surface"))
		}
		if request.Header.Get("Origin") != "" {
			t.Fatal("browser origin must stop at Gateway")
		}
		for _, header := range []string{"X-Merchant-Id", "X-Commercial-Id", "X-Liveshop-Subject", "X-Liveshop-Shop-Code", "X-Liveshop-Authorization-Revision"} {
			if request.Header.Get(header) != "" {
				t.Fatalf("browser-controlled context header reached Identity: %s", header)
			}
		}
		http.SetCookie(w, &http.Cookie{Name: "liveshop_refresh", Value: "opaque", Path: "/auth", HttpOnly: true})
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	gateway := New(Config{IdentityURL: upstream.URL, PlatformRegistryURL: "http://platform.invalid", SurfaceOrigins: map[string][]string{"admin": {"https://host.example"}}})
	request := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"realm":"PLATFORM"}`))
	request.Header.Set("Origin", "https://host.example")
	request.Header.Set("X-Liveshop-Surface", "admin")
	request.Header.Set("X-Merchant-Id", "2001")
	request.Header.Set("X-Commercial-Id", "3001")
	request.Header.Set("X-Liveshop-Subject", "forged")
	request.Header.Set("X-Liveshop-Shop-Code", "forged-shop")
	request.Header.Set("X-Liveshop-Authorization-Revision", "999")
	response := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("platform proxy returned %d", response.Code)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "https://host.example" || response.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("gateway must own credentialed browser CORS")
	}
	if len(response.Result().Cookies()) != 1 || response.Result().Cookies()[0].Name != "liveshop_refresh" {
		t.Fatal("identity refresh cookie must pass through gateway")
	}
}

func TestCORSAllowsConfiguredIframeArtifactOrigin(t *testing.T) {
	gateway := New(Config{
		PlatformRegistryURL: "http://platform.invalid",
		SurfaceOrigins:      map[string][]string{"merch": {"http://127.0.0.1:5174", "http://127.0.0.1:5191"}},
	})
	request := httptest.NewRequest(http.MethodOptions, "/merch/catalog/products", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5191")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "authorization,x-liveshop-surface")
	response := httptest.NewRecorder()

	gateway.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("iframe preflight returned %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:5191" {
		t.Fatalf("unexpected allow origin %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
	if !headerContainsToken(response.Header().Values("Vary"), "Origin") {
		t.Fatal("credentialed CORS response must vary by origin")
	}
}

func TestCORSPreflightAllowsIdempotencyKey(t *testing.T) {
	gateway := New(Config{
		PlatformRegistryURL: "http://platform.invalid",
		SurfaceOrigins:      map[string][]string{"merch": {"http://127.0.0.1:5191"}},
	})
	request := httptest.NewRequest(http.MethodOptions, "/merch/catalog/categories", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5191")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type,x-liveshop-surface,idempotency-key")
	response := httptest.NewRecorder()

	gateway.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("idempotent create preflight returned %d: %s", response.Code, response.Body.String())
	}
	if !headerContainsToken(response.Header().Values("Access-Control-Allow-Headers"), "Idempotency-Key") {
		t.Fatalf("preflight must allow Idempotency-Key, got %q", response.Header().Get("Access-Control-Allow-Headers"))
	}
}

func headerContainsToken(values []string, token string) bool {
	for _, value := range values {
		for _, candidate := range strings.Split(value, ",") {
			if strings.TrimSpace(candidate) == token {
				return true
			}
		}
	}
	return false
}

func TestCORSRejectsUnconfiguredIframeArtifactOrigin(t *testing.T) {
	gateway := New(Config{PlatformRegistryURL: "http://platform.invalid", SurfaceOrigins: map[string][]string{"merch": {"http://127.0.0.1:5174"}}})
	request := httptest.NewRequest(http.MethodOptions, "/merch/catalog/products", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5191")
	response := httptest.NewRecorder()

	gateway.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("unconfigured iframe origin returned %d", response.Code)
	}
}

func TestCORSRejectsMerchantOriginImpersonatingAdminSurface(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		upstreamCalls++
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	gateway := New(Config{
		IdentityURL:         upstream.URL,
		PlatformRegistryURL: "http://platform.invalid",
		SurfaceOrigins: map[string][]string{
			"admin": {"https://admin.example", "https://admin-iframe.example"},
			"merch": {"https://merch-iframe.example"},
		},
	})

	request := httptest.NewRequest(http.MethodPost, "/auth/refresh", nil)
	request.Header.Set("Origin", "https://merch-iframe.example")
	request.Header.Set("X-Liveshop-Surface", "admin")
	response := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("merchant origin admin refresh returned %d", response.Code)
	}
	if upstreamCalls != 0 {
		t.Fatalf("cross-surface request reached Identity %d times", upstreamCalls)
	}

	for _, origin := range []string{"https://admin.example", "https://admin-iframe.example"} {
		request := httptest.NewRequest(http.MethodPost, "/auth/refresh", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("X-Liveshop-Surface", "admin")
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != origin {
			t.Fatalf("valid admin origin %s returned %d", origin, response.Code)
		}
	}
}

func TestCORSPreflightRejectsCrossSurfaceModulePath(t *testing.T) {
	gateway := New(Config{PlatformRegistryURL: "http://platform.invalid", SurfaceOrigins: map[string][]string{"merch": {"https://merch.example"}}})
	request := httptest.NewRequest(http.MethodOptions, "/admin/identity/directory", nil)
	request.Header.Set("Origin", "https://merch.example")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "authorization,x-liveshop-surface")
	response := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-surface module preflight returned %d", response.Code)
	}
}

func TestGatewayRoutesAllBrowserRuntimeTrafficToIdentity(t *testing.T) {
	seen := map[string]int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		seen[request.Method+" "+request.URL.Path]++
		if request.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatal("access identity was not forwarded")
		}
		if request.Header.Get("X-Merchant-Id") != "" || request.Header.Get("X-Liveshop-Subject") != "" {
			t.Fatal("browser-controlled context reached Identity runtime")
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"revision":2,"items":[]}}`))
	}))
	defer upstream.Close()

	gateway := New(Config{IdentityURL: upstream.URL, PlatformRegistryURL: "http://platform.invalid"})
	for path, method := range map[string]string{
		"/runtime/v1/contributions":   http.MethodGet,
		"/runtime/v1/module-sessions": http.MethodPost,
		"/runtime/v1/iam/me":          http.MethodGet,
		"/runtime/v1/module-catalog":  http.MethodGet,
	} {
		request := httptest.NewRequest(method, path, nil)
		request.Header.Set("Authorization", "Bearer access-token")
		request.Header.Set("X-Liveshop-Surface", "admin")
		request.Header.Set("X-Merchant-Id", "forged")
		request.Header.Set("X-Liveshop-Subject", "forged")
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s returned %d", path, response.Code)
		}
		if seen[method+" "+path] != 1 {
			t.Fatalf("Identity did not receive exactly one %s %s request", method, path)
		}
	}
}

func TestGatewayReadinessRequiresNonEmptyRegistrySnapshot(t *testing.T) {
	gateway := New(Config{PlatformRegistryURL: "http://platform.invalid", MaxStaleness: time.Minute})
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("empty Registry snapshot readiness returned %d", response.Code)
	}

	gateway.current.Store(&snapshot{
		revision: 2,
		routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
			ModuleID: "identity", Surface: "admin", Prefix: "/admin/identity", Origin: "http://identity:8092",
		}}},
		loadedAt: time.Now(),
	})
	response = httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("compiled Registry snapshot readiness returned %d", response.Code)
	}
}

func TestGatewayReadinessAndModuleRoutingRejectStaleSnapshot(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	gateway := New(Config{PlatformRegistryURL: "http://platform.invalid", MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{
		revision: 2,
		routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
			ModuleID: "catalog", Surface: "merch", Prefix: "/merch/catalog", Origin: upstream.URL,
		}, proxy: newModuleProxy(origin, "catalog")}},
		loadedAt: time.Now().Add(-time.Minute - time.Millisecond),
	})

	response := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("stale readiness returned %d", response.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "/merch/catalog/products", nil)
	request.Header.Set("X-Liveshop-Surface", "merch")
	response = httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("stale route snapshot returned %d", response.Code)
	}
}

func TestBrowserProxyRejectsInternalAndUnknownRoutes(t *testing.T) {
	gateway := New(Config{IdentityURL: "http://identity.invalid", PlatformRegistryURL: "http://platform.invalid"})
	for _, path := range []string{"/internal/v1/module-registry/routes", "/runtime/v1/not-published"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("X-Liveshop-Surface", "admin")
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s returned %d", path, response.Code)
		}
	}
}

func TestIdentityProxyRequiresSurfaceAndExactMethod(t *testing.T) {
	gateway := New(Config{IdentityURL: "http://identity.invalid", PlatformRegistryURL: "http://platform.invalid"})
	response := httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("missing surface returned %d", response.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "/auth/login", nil)
	request.Header.Set("X-Liveshop-Surface", "admin")
	response = httptest.NewRecorder()
	gateway.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong method returned %d", response.Code)
	}
}

func TestPathMatchesSegmentBoundary(t *testing.T) {
	if !pathMatches("/shop/catalog/items", "/shop/catalog") {
		t.Fatal("expected match")
	}
	if pathMatches("/shop/catalogue", "/shop/catalog") {
		t.Fatal("prefix must end on a segment boundary")
	}
}

func TestRouteCompilationRejectsAmbiguousOperationTemplates(t *testing.T) {
	_, ok := compileRoutes(context.Background(), []modulemanifest.ActiveRoute{{
		ModuleID: "catalog", Surface: "shop", Prefix: "/shop/catalog", Origin: "http://catalog:8090",
		Operations: []modulemanifest.ActiveRouteOperation{
			{Method: http.MethodGet, Path: "/shop/catalog/products/{id}", Authentication: "public"},
			{Method: http.MethodGet, Path: "/shop/catalog/products/{slug}", Authentication: "module-session"},
		},
	}})
	if ok {
		t.Fatal("ambiguous operation templates were compiled")
	}
}

func TestGatewayExposesOnlyTheDeclaredPublicOperation(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		upstreamCalls++
		if request.Header.Get("Authorization") != "" {
			t.Fatal("a browser Authorization header reached a public module operation")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid", MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{revision: 1, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
		ModuleID: "catalog", Surface: "shop", Prefix: "/shop/catalog", Origin: upstream.URL,
		Operations: []modulemanifest.ActiveRouteOperation{{Method: http.MethodGet, Path: "/shop/catalog/products/{id}", Authentication: "public"}},
	}, proxy: newModuleProxy(origin, "catalog")}}, loadedAt: time.Now()})

	request := httptest.NewRequest(http.MethodGet, "/shop/catalog/products/1001", nil)
	request.Header.Set("X-Liveshop-Surface", "shop")
	request.Header.Set("Authorization", "Bearer browser-controlled")
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || upstreamCalls != 1 {
		t.Fatalf("declared public operation returned %d with %d upstream calls", response.Code, upstreamCalls)
	}

	for _, path := range []string{"/shop/catalog/products", "/shop/catalog/products/1001/private"} {
		request = httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("X-Liveshop-Surface", "shop")
		response = httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("undeclared sibling %s returned %d", path, response.Code)
		}
	}
	if upstreamCalls != 1 {
		t.Fatalf("undeclared routes reached upstream %d times", upstreamCalls-1)
	}
}

func TestGatewayPublicOperationDoesNotRequireSurface(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		upstreamCalls++
		if request.Header.Get("Authorization") != "" {
			t.Fatal("a browser Authorization header reached a public module operation")
		}
		if request.URL.Path != "/uploads/_storage_test/ping.txt" {
			t.Fatalf("upstream path=%s", request.URL.Path)
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("liveshop storage connectivity test\n"))
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid", MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{revision: 1, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
		ModuleID: "platform", Surface: "admin", Prefix: "/uploads", Origin: upstream.URL,
		Operations: []modulemanifest.ActiveRouteOperation{{Method: http.MethodGet, Path: "/uploads/{folder}/{name}", Authentication: "public"}},
	}, proxy: newModuleProxy(origin, "platform")}}, loadedAt: time.Now()})

	request := httptest.NewRequest(http.MethodGet, "/uploads/_storage_test/ping.txt", nil)
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusOK || upstreamCalls != 1 || response.Body.String() != "liveshop storage connectivity test\n" {
		t.Fatalf("public upload without surface returned %d body=%q calls=%d", response.Code, response.Body.String(), upstreamCalls)
	}

	request = httptest.NewRequest(http.MethodGet, "/admin/platform/storage/channels", nil)
	response = httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("protected route without surface returned %d", response.Code)
	}
}

func TestGatewaySeparatesGuestAndLoginRequiredOperations(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	issuer, _ := modulesession.NewIssuer("nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", "capability-1", "test-identity")
	verifier, _ := modulesession.NewGatewayVerifier(map[string]string{"capability-1": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}, "test-identity")
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid", Capabilities: verifier, MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{revision: 2, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
		ModuleID: "catalog", Surface: "shop", Prefix: "/shop/catalog", Origin: upstream.URL,
		Operations: []modulemanifest.ActiveRouteOperation{
			{Method: http.MethodGet, Path: "/shop/catalog/products", Authentication: "guest-session"},
			{Method: http.MethodGet, Path: "/shop/catalog/account", Authentication: "module-session"},
		},
	}, proxy: newModuleProxy(origin, "catalog")}}, loadedAt: time.Now()})
	token, err := issuer.Sign(modulesession.Claims{
		Subject: "guest-1", Realm: principal.RealmCustomer, PrincipalType: principal.TypeGuest,
		SessionID: "session-1", MerchantID: 2001, ShopID: 5001,
		AuthorizationRevision: 1, IdentityVersion: 1, ContextVersion: 1, EntitlementRevision: 1, RegistryRevision: 2,
		ModuleID: "catalog", ModuleVersion: "1.0.0", Surface: "shop", ContributionID: "catalog.shop",
		AllowedRoutes: []modulesession.RouteScope{{Methods: []string{"GET"}, Prefix: "/shop/catalog"}},
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	for path, expected := range map[string]int{
		"/shop/catalog/products": http.StatusNoContent,
		"/shop/catalog/account":  http.StatusForbidden,
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("X-Liveshop-Surface", "shop")
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != expected {
			t.Fatalf("%s returned %d, want %d", path, response.Code, expected)
		}
	}
}

func TestGatewayEnforcesSignedMethodAndRouteScope(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Origin") != "" {
			t.Error("browser origin must stop at Gateway before module proxying")
		}
		if request.Header.Get("X-Liveshop-Module-ID") != "catalog" {
			t.Errorf("verified module id was not established by Gateway: %q", request.Header.Get("X-Liveshop-Module-ID"))
		}
		if request.Header.Get("X-Merchant-ID") != "" || request.Header.Get("X-User-ID") != "" {
			t.Error("browser-controlled context reached module upstream")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	issuer, _ := modulesession.NewIssuer("nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", "capability-1", "test-identity")
	verifier, _ := modulesession.NewGatewayVerifier(map[string]string{"capability-1": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}, "test-identity")
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid", Capabilities: verifier, SurfaceOrigins: map[string][]string{"shop": {"https://host.example"}}, MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{revision: 1, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
		ModuleID: "catalog", Surface: "shop", Prefix: "/shop/catalog", Origin: upstream.URL,
		Operations: []modulemanifest.ActiveRouteOperation{
			{Method: http.MethodGet, Path: "/shop/catalog/products", Authentication: "module-session"},
			{Method: http.MethodPost, Path: "/shop/catalog/products", Authentication: "module-session"},
		},
	}, proxy: newModuleProxy(origin, "catalog")}}, loadedAt: time.Now()})
	token, err := issuer.Sign(modulesession.Claims{
		Subject: "user-1", Realm: principal.RealmMerchant, PrincipalType: principal.TypeMerchantStaff,
		SessionID: "session-1", OrganizationID: 3001, OrganizationVersion: 1,
		MerchantID: 2001, ShopID: 5001,
		AuthorizationRevision: 1, IdentityVersion: 1, ContextVersion: 1, EntitlementRevision: 1, RegistryRevision: 1,
		ModuleID: "catalog", ModuleVersion: "1.0.0", Surface: "shop", ContributionID: "catalog.shop",
		Permissions: []string{"catalog.product.read"}, AllowedRoutes: []modulesession.RouteScope{{Methods: []string{"GET"}, Prefix: "/shop/catalog"}},
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/shop/catalog/products", nil)
	request.Header.Set("X-Liveshop-Surface", "shop")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Origin", "https://host.example")
	request.Header.Set("X-Liveshop-Module-ID", "forged")
	request.Header.Set("X-Merchant-ID", "9999")
	request.Header.Set("X-User-ID", "forged")
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("authorized request got %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/shop/catalog/products", nil)
	request.Header.Set("X-Liveshop-Surface", "shop")
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("out-of-scope method got %d", response.Code)
	}
}

func TestGatewayRejectsCapabilityFromDifferentRegistryRevision(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	issuer, _ := modulesession.NewIssuer("nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", "capability-1", "test-identity")
	verifier, _ := modulesession.NewGatewayVerifier(map[string]string{"capability-1": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}, "test-identity")
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid", Capabilities: verifier, MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{revision: 9, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
		ModuleID: "catalog", Surface: "merch", Prefix: "/merch/catalog", Origin: upstream.URL,
		Operations: []modulemanifest.ActiveRouteOperation{{Method: http.MethodGet, Path: "/merch/catalog/products", Authentication: "module-session"}},
	}, proxy: newModuleProxy(origin, "catalog")}}, loadedAt: time.Now()})
	token, err := issuer.Sign(modulesession.Claims{
		Subject: "staff-1", Realm: principal.RealmMerchant, PrincipalType: principal.TypeMerchantStaff,
		SessionID: "session-1", OrganizationID: 3001, OrganizationVersion: 1,
		MerchantID: 2001, ShopID: 5001,
		AuthorizationRevision: 1, IdentityVersion: 1, ContextVersion: 1, EntitlementRevision: 1, RegistryRevision: 8,
		ModuleID: "catalog", ModuleVersion: "1.0.0", Surface: "merch", ContributionID: "catalog.merch.products",
		Permissions: []string{"catalog.product.read"}, AllowedRoutes: []modulesession.RouteScope{{Methods: []string{"GET"}, Prefix: "/merch/catalog"}},
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/merch/catalog/products", nil)
	request.Header.Set("X-Liveshop-Surface", "merch")
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("stale Registry revision capability got %d", response.Code)
	}
}

func TestGatewayRejectsCapabilityWithoutEntitlementRevision(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	origin, _ := url.Parse(upstream.URL)
	issuer, _ := modulesession.NewIssuer("nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", "capability-1", "test-identity")
	verifier, _ := modulesession.NewGatewayVerifier(map[string]string{"capability-1": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}, "test-identity")
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid", Capabilities: verifier, MaxStaleness: time.Minute})
	gateway.current.Store(&snapshot{revision: 9, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{
		ModuleID: "catalog", Surface: "merch", Prefix: "/merch/catalog", Origin: upstream.URL,
		Operations: []modulemanifest.ActiveRouteOperation{{Method: http.MethodGet, Path: "/merch/catalog/products", Authentication: "module-session"}},
	}, proxy: newModuleProxy(origin, "catalog")}}, loadedAt: time.Now()})
	token, err := issuer.Sign(modulesession.Claims{
		Subject: "staff-1", Realm: principal.RealmMerchant, PrincipalType: principal.TypeMerchantStaff,
		SessionID: "session-1", OrganizationID: 3001, OrganizationVersion: 1,
		MerchantID: 2001, ShopID: 5001,
		AuthorizationRevision: 1, IdentityVersion: 1, ContextVersion: 1, RegistryRevision: 9,
		ModuleID: "catalog", ModuleVersion: "1.0.0", Surface: "merch", ContributionID: "catalog.merch.products",
		Permissions: []string{"catalog.product.read"}, AllowedRoutes: []modulesession.RouteScope{{Methods: []string{"GET"}, Prefix: "/merch/catalog"}},
	}, time.Minute)
	if err == nil {
		request := httptest.NewRequest(http.MethodGet, "/merch/catalog/products", nil)
		request.Header.Set("X-Liveshop-Surface", "merch")
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		gateway.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("capability without entitlement revision got %d", response.Code)
		}
	}
}

func TestGatewayDoesNotAcceptSurfaceFromQuery(t *testing.T) {
	gateway := New(Config{PlatformRegistryURL: "http://registry.invalid"})
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/shop/catalog?_surface=shop", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("got %d", response.Code)
	}
}

func TestRouteRefreshUsesAuthorizedWorkloadIdentity(t *testing.T) {
	verifier, _ := workloadidentity.NewVerifier(map[string]workloadidentity.TrustedWorkload{"gateway-1": {PublicKey: "ky88xYQS66lbhNA-cUpijVuxRWcWAdFRgMIHFKF7PkA", Subject: "liveshop-gateway", Permissions: []string{"registry.routes.read"}}}, "test-workloads", "liveshop-platform-internal")
	registryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		token, ok := workloadidentity.Bearer(request.Header.Get("Authorization"))
		if !ok {
			http.Error(w, "missing workload", http.StatusUnauthorized)
			return
		}
		if _, err := verifier.Authorize(token, "registry.routes.read"); err != nil {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"revision":9,"routes":[]}}`))
	}))
	defer registryServer.Close()
	issuer, _ := workloadidentity.NewIssuer("k51SIJI3oT-PJGXf2uWjL6jyTiDJ1Nwmk6l1ehqDrqA", "gateway-1", "test-workloads", "liveshop-gateway", "liveshop-platform-internal")
	gateway := New(Config{PlatformRegistryURL: registryServer.URL, Workload: issuer})
	gateway.refresh(context.Background())
	if gateway.current.Load().revision != 9 {
		t.Fatalf("route revision was not refreshed")
	}
}

func TestRouteRefreshRetainsValidSnapshotForEmptyOrStaleResponses(t *testing.T) {
	issuer, _ := workloadidentity.NewIssuer("k51SIJI3oT-PJGXf2uWjL6jyTiDJ1Nwmk6l1ehqDrqA", "gateway-1", "test-workloads", "liveshop-gateway", "liveshop-platform-internal")
	for _, test := range []struct {
		name     string
		response string
	}{
		{name: "empty", response: `{"code":0,"data":{"revision":9,"routes":[]}}`},
		{name: "stale", response: `{"code":0,"data":{"revision":7,"routes":[{"moduleId":"catalog","surface":"shop","prefix":"/shop/catalog","origin":"http://catalog:8090"}]}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			registryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(test.response))
			}))
			defer registryServer.Close()
			gateway := New(Config{PlatformRegistryURL: registryServer.URL, Workload: issuer})
			gateway.current.Store(&snapshot{revision: 8, routes: []route{{ActiveRoute: modulemanifest.ActiveRoute{ModuleID: "platform", Surface: "admin", Prefix: "/admin/platform", Origin: "http://platform:8082"}}}, loadedAt: time.Now()})

			gateway.refresh(context.Background())
			current := gateway.current.Load()
			if current.revision != 8 || len(current.routes) != 1 || current.routes[0].ModuleID != "platform" {
				t.Fatalf("valid snapshot was replaced: revision=%d routes=%d", current.revision, len(current.routes))
			}
		})
	}
}

func TestStripUpstreamCORS(t *testing.T) {
	response := &http.Response{Header: http.Header{
		"Access-Control-Allow-Origin":  {"*"},
		"Access-Control-Allow-Headers": {"Authorization"},
		"Content-Type":                 {"application/json"},
	}}
	if err := stripUpstreamCORS(response); err != nil {
		t.Fatal(err)
	}
	if response.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("upstream CORS header must not be forwarded")
	}
	if response.Header.Get("Content-Type") != "application/json" {
		t.Fatal("non-CORS response headers must be preserved")
	}
}
