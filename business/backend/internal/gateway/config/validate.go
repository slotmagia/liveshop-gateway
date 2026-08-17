package config

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/lvtuopen-ai/kernel-go/principal"
)

type field struct {
	name  string
	value string
}

// Validate proves every value the process needs is present and well formed,
// and stores the parsed durations. A Gateway that cannot reach Platform must
// fail here rather than fall back to a local address.
func Validate(cfg *Config) error {
	validators := []func(*Config) error{
		validateCommon,
		validateServer,
		validateIdentity,
		validatePlatform,
		validateModuleCapability,
		validateWorkloadIdentity,
		validateHTTP,
		validateRouteRefresh,
	}
	for _, validate := range validators {
		if err := validate(cfg); err != nil {
			return err
		}
	}
	return nil
}

func validateCommon(cfg *Config) error {
	if err := requireFields([]field{
		{name: "service", value: cfg.Service},
		{name: "log.level", value: cfg.Log.Level},
		{name: "log.format", value: cfg.Log.Format},
	}); err != nil {
		return err
	}
	if cfg.Log.Format != "text" && cfg.Log.Format != "json" {
		return fmt.Errorf("gateway: config log.format must be text or json")
	}
	return nil
}

func validateServer(cfg *Config) error {
	return require("server.http", cfg.Server.HTTP)
}

func validatePlatform(cfg *Config) error {
	return validateOrigin("platform.registry_url", cfg.Platform.RegistryURL)
}

func validateIdentity(cfg *Config) error {
	return validateOrigin("identity.origin_url", cfg.Identity.OriginURL)
}

func validateOrigin(name, value string) error {
	if err := require(name, value); err != nil {
		return err
	}
	origin, err := url.Parse(value)
	if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Host == "" || origin.RawQuery != "" || origin.Fragment != "" {
		return fmt.Errorf("gateway: config %s must be an http(s) origin", name)
	}
	return nil
}

func validateModuleCapability(cfg *Config) error {
	return requireFields([]field{
		{name: "module_capability.key_id", value: cfg.ModuleCapability.KeyID},
		{name: "module_capability.public_key", value: cfg.ModuleCapability.PublicKey},
		{name: "module_capability.issuer", value: cfg.ModuleCapability.Issuer},
	})
}

func validateWorkloadIdentity(cfg *Config) error {
	return requireFields([]field{
		{name: "workload_identity.key_id", value: cfg.WorkloadIdentity.KeyID},
		{name: "workload_identity.private_key", value: cfg.WorkloadIdentity.PrivateKey},
		{name: "workload_identity.issuer", value: cfg.WorkloadIdentity.Issuer},
	})
}

func validateHTTP(cfg *Config) error {
	if len(cfg.HTTP.SurfaceOrigins) == 0 {
		return fmt.Errorf("gateway: config http.surface_origins is required")
	}
	owners := make(map[string]string)
	surfaces := make([]string, 0, len(cfg.HTTP.SurfaceOrigins))
	for surface := range cfg.HTTP.SurfaceOrigins {
		surfaces = append(surfaces, surface)
	}
	sort.Strings(surfaces)
	for _, surface := range surfaces {
		origins := cfg.HTTP.SurfaceOrigins[surface]
		if _, ok := principal.ParseSurface(surface); !ok {
			return fmt.Errorf("gateway: config http.surface_origins contains unknown surface %q", surface)
		}
		if len(origins) == 0 {
			return fmt.Errorf("gateway: config http.surface_origins.%s must not be empty", surface)
		}
		for index, origin := range origins {
			origin = strings.TrimSpace(origin)
			parsed, err := url.Parse(origin)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
				return fmt.Errorf("gateway: config http.surface_origins.%s[%d] must be a bare http(s) origin", surface, index)
			}
			if existing, duplicate := owners[origin]; duplicate {
				return fmt.Errorf("gateway: browser origin %s is assigned to both %s and %s", origin, existing, surface)
			}
			owners[origin] = surface
		}
	}
	return nil
}

func validateRouteRefresh(cfg *Config) error {
	interval, err := positiveDuration("route_refresh.interval", cfg.RouteRefresh.Interval)
	if err != nil {
		return err
	}
	timeout, err := positiveDuration("route_refresh.timeout", cfg.RouteRefresh.Timeout)
	if err != nil {
		return err
	}
	if timeout > interval {
		return fmt.Errorf("gateway: config route_refresh.timeout must not exceed route_refresh.interval")
	}
	maxStaleness, err := positiveDuration("route_refresh.max_staleness", cfg.RouteRefresh.MaxStaleness)
	if err != nil {
		return err
	}
	if maxStaleness <= interval {
		return fmt.Errorf("gateway: config route_refresh.max_staleness must exceed route_refresh.interval")
	}
	cfg.refreshInterval = interval
	cfg.refreshTimeout = timeout
	cfg.maxStaleness = maxStaleness
	return nil
}

func positiveDuration(name, value string) (time.Duration, error) {
	duration, err := time.ParseDuration(value)
	if err != nil || duration <= 0 {
		return 0, fmt.Errorf("gateway: config %s must be a positive duration", name)
	}
	return duration, nil
}

func requireFields(fields []field) error {
	for _, item := range fields {
		if err := require(item.name, item.value); err != nil {
			return err
		}
	}
	return nil
}

func require(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("gateway: config %s is required", name)
	}
	return nil
}
