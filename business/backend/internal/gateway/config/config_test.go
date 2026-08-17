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
