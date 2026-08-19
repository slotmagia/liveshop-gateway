package config

import (
	"testing"
	"time"
)

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*Config)
		wantErr string
	}{
		{name: "valid config"},
		{
			name:    "missing service name",
			mutate:  func(cfg *Config) { cfg.Service = "" },
			wantErr: "gateway: config service is required",
		},
		{
			name:    "invalid log format",
			mutate:  func(cfg *Config) { cfg.Log.Format = "console" },
			wantErr: "gateway: config log.format must be text or json",
		},
		{
			name:    "missing HTTP address",
			mutate:  func(cfg *Config) { cfg.Server.HTTP = "" },
			wantErr: "gateway: config server.http is required",
		},
		{
			name:    "missing identity origin",
			mutate:  func(cfg *Config) { cfg.Identity.OriginURL = "" },
			wantErr: "gateway: config identity.origin_url is required",
		},
		{
			name:    "identity URL is not an origin",
			mutate:  func(cfg *Config) { cfg.Identity.OriginURL = "identity:18092" },
			wantErr: "gateway: config identity.origin_url must be an http(s) origin",
		},
		{
			name:    "missing registry URL",
			mutate:  func(cfg *Config) { cfg.Platform.RegistryURL = "" },
			wantErr: "gateway: config platform.registry_url is required",
		},
		{
			name:    "registry URL is not an origin",
			mutate:  func(cfg *Config) { cfg.Platform.RegistryURL = "registry:18070" },
			wantErr: "gateway: config platform.registry_url must be an http(s) origin",
		},
		{
			name:    "missing module capability public key",
			mutate:  func(cfg *Config) { cfg.ModuleCapability.PublicKey = "" },
			wantErr: "gateway: config module_capability.public_key is required",
		},
		{
			name:    "missing workload private key",
			mutate:  func(cfg *Config) { cfg.WorkloadIdentity.PrivateKey = "" },
			wantErr: "gateway: config workload_identity.private_key is required",
		},
		{
			name:    "missing surface origins",
			mutate:  func(cfg *Config) { cfg.HTTP.SurfaceOrigins = nil },
			wantErr: "gateway: config http.surface_origins is required",
		},
		{
			name: "surface origin carries a path",
			mutate: func(cfg *Config) {
				cfg.HTTP.SurfaceOrigins = map[string][]string{"admin": {"http://127.0.0.1:15173/admin"}}
			},
			wantErr: "gateway: config http.surface_origins.admin[0] must be a bare http(s) origin",
		},
		{
			name: "origin belongs to two surfaces",
			mutate: func(cfg *Config) {
				cfg.HTTP.SurfaceOrigins = map[string][]string{"admin": {"http://127.0.0.1:15173"}, "merch": {"http://127.0.0.1:15173"}}
			},
			wantErr: "gateway: browser origin http://127.0.0.1:15173 is assigned to both admin and merch",
		},
		{
			name:    "invalid refresh interval",
			mutate:  func(cfg *Config) { cfg.RouteRefresh.Interval = "never" },
			wantErr: "gateway: config route_refresh.interval must be a positive duration",
		},
		{
			name:    "timeout exceeds interval",
			mutate:  func(cfg *Config) { cfg.RouteRefresh.Timeout = "30s" },
			wantErr: "gateway: config route_refresh.timeout must not exceed route_refresh.interval",
		},
		{
			name:    "max staleness does not exceed interval",
			mutate:  func(cfg *Config) { cfg.RouteRefresh.MaxStaleness = "5s" },
			wantErr: "gateway: config route_refresh.max_staleness must exceed route_refresh.interval",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cfg := validConfig()
			if test.mutate != nil {
				test.mutate(cfg)
			}
			err := Validate(cfg)
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("valid Gateway config: %v", err)
				}
				return
			}
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("Validate() error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

// Validate is the only place that parses the refresh durations; callers read
// them back as typed values instead of re-parsing the configured strings.
func TestValidateParsesRefreshDurations(t *testing.T) {
	cfg := validConfig()
	if err := Validate(cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.RefreshInterval() != 5*time.Second || cfg.RefreshTimeout() != 3*time.Second || cfg.MaxStaleness() != 30*time.Second {
		t.Fatalf("parsed refresh durations = %v / %v / %v", cfg.RefreshInterval(), cfg.RefreshTimeout(), cfg.MaxStaleness())
	}
}

// A missing file must fail rather than silently start on built-in defaults.
func TestLoadRejectsMissingConfig(t *testing.T) {
	if _, err := Load(""); err == nil {
		t.Fatal("an empty -config was accepted")
	}
	if _, err := Load(t.TempDir() + "/absent.yaml"); err == nil {
		t.Fatal("a missing config file was accepted")
	}
}

func validConfig() *Config {
	cfg := &Config{Service: "gateway"}
	cfg.Log.Level = "info"
	cfg.Log.Format = "text"
	cfg.Server.HTTP = ":18081"
	cfg.Identity.OriginURL = "http://identity:18092"
	cfg.Platform.RegistryURL = "http://registry:18070"
	cfg.ModuleCapability.KeyID = "module-capability-dev-1"
	cfg.ModuleCapability.PublicKey = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
	cfg.ModuleCapability.Issuer = "liveshop-identity"
	cfg.WorkloadIdentity.KeyID = "gateway-workload-dev-1"
	cfg.WorkloadIdentity.PrivateKey = "k51SIJI3oT-PJGXf2uWjL6jyTiDJ1Nwmk6l1ehqDrqA"
	cfg.WorkloadIdentity.Issuer = "liveshop-workload-identity"
	cfg.HTTP.SurfaceOrigins = map[string][]string{"admin": {"http://127.0.0.1:15173"}}
	cfg.RouteRefresh.Interval = "5s"
	cfg.RouteRefresh.Timeout = "3s"
	cfg.RouteRefresh.MaxStaleness = "30s"
	return cfg
}
