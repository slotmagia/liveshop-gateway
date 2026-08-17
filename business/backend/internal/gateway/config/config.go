// Package config owns the Gateway process configuration schema and its
// validation. It performs no dependency construction.
package config

import (
	"errors"
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the Gateway process configuration provided by the complete YAML
// file named on the command line. There is no environment override and no
// code default: a missing value is a startup failure.
type Config struct {
	Service string `yaml:"service"`
	Log     struct {
		Level  string `yaml:"level"`
		Format string `yaml:"format"`
	} `yaml:"log"`
	Server struct {
		HTTP string `yaml:"http"`
	} `yaml:"server"`
	Platform struct {
		RegistryURL string `yaml:"registry_url"`
	} `yaml:"platform"`
	Identity struct {
		OriginURL string `yaml:"origin_url"`
	} `yaml:"identity"`
	ModuleCapability struct {
		KeyID     string `yaml:"key_id"`
		PublicKey string `yaml:"public_key"`
		Issuer    string `yaml:"issuer"`
	} `yaml:"module_capability"`
	WorkloadIdentity struct {
		KeyID      string `yaml:"key_id"`
		PrivateKey string `yaml:"private_key"`
		Issuer     string `yaml:"issuer"`
	} `yaml:"workload_identity"`
	HTTP struct {
		// SurfaceOrigins binds every browser document origin to exactly one
		// security surface. A flat origin allowlist would let a Merchant iframe
		// ask for an Admin refresh token with credentialed CORS.
		SurfaceOrigins map[string][]string `yaml:"surface_origins"`
	} `yaml:"http"`
	RouteRefresh struct {
		Interval     string `yaml:"interval"`
		Timeout      string `yaml:"timeout"`
		MaxStaleness string `yaml:"max_staleness"`
	} `yaml:"route_refresh"`

	// Durations are parsed once by Validate so no caller repeats the format.
	refreshInterval time.Duration
	refreshTimeout  time.Duration
	maxStaleness    time.Duration
}

// RefreshInterval is how often the route snapshot is pulled from Platform.
func (c *Config) RefreshInterval() time.Duration { return c.refreshInterval }

// RefreshTimeout bounds one route snapshot request.
func (c *Config) RefreshTimeout() time.Duration { return c.refreshTimeout }

// MaxStaleness is the bounded last-valid window. Once it elapses both
// readiness and module routing fail closed.
func (c *Config) MaxStaleness() time.Duration { return c.maxStaleness }

// Load reads and validates the configuration file selected at startup.
// Unknown keys are rejected so a stale or misspelled field cannot be ignored.
func Load(path string) (*Config, error) {
	if path == "" {
		return nil, errors.New("gateway: -config is required")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("gateway: open config: %w", err)
	}
	defer file.Close()

	decoder := yaml.NewDecoder(file)
	decoder.KnownFields(true)
	var cfg Config
	if err := decoder.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("gateway: decode config %s: %w", path, err)
	}
	if err := Validate(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
