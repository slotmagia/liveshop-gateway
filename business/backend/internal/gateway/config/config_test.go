package config

import (
	"os"
	"path/filepath"
	"testing"
)

// The shipped local configuration must stay loadable, so the documented way to
// start the process is always known to work.
func TestLoadLocalConfiguration(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "..", "configs", "gateway.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Service != "gateway" || cfg.Server.HTTP == "" || len(cfg.HTTP.SurfaceOrigins) == 0 {
		t.Fatalf("unexpected local configuration: %#v", cfg)
	}
}

func TestShippedConfigurationsAllowInternalTestOrigins(t *testing.T) {
	for _, filename := range []string{"gateway.yaml", "gateway.compose.yaml"} {
		cfg, err := Load(filepath.Join("..", "..", "..", "configs", filename))
		if err != nil {
			t.Fatalf("load %s: %v", filename, err)
		}
		for surface, origin := range map[string]string{
			"admin": "http://192.168.5.140:15173",
			"merch": "http://192.168.5.140:15174",
			"shop":  "http://192.168.5.140:15175",
			"live":  "http://192.168.5.140:15176",
		} {
			if !contains(cfg.HTTP.SurfaceOrigins[surface], origin) {
				t.Errorf("%s %s origins do not contain %s", filename, surface, origin)
			}
		}
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestLoadRejectsUnknownField(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway.yaml")
	document := "service: gateway\nlog:\n  level: info\n  format: text\nunexpected_key: 1\n"
	if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("an unknown configuration key was ignored")
	}
}
