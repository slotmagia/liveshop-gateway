package app

import (
	"fmt"

	"github.com/lvtuopen-ai/liveshop-gateway/backend/internal/gateway/common/server"
	"github.com/lvtuopen-ai/liveshop-gateway/backend/internal/gateway/config"
)

type instance struct {
	address string
	gateway *server.Gateway
}

// bootstrap loads configuration, assembles credentials and constructs the data
// plane. Nothing listens until Run starts it.
func bootstrap(configPath string) (*instance, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}
	deps, err := NewDependencies(cfg)
	if err != nil {
		return nil, fmt.Errorf("gateway: assemble dependencies: %w", err)
	}
	gateway := server.New(server.Config{
		IdentityURL:         cfg.Identity.OriginURL,
		PlatformRegistryURL: cfg.Platform.RegistryURL,
		Workload:            deps.Workload,
		Capabilities:        deps.Capabilities,
		SurfaceOrigins:      cfg.HTTP.SurfaceOrigins,
		RefreshInterval:     cfg.RefreshInterval(),
		RefreshTimeout:      cfg.RefreshTimeout(),
		MaxStaleness:        cfg.MaxStaleness(),
	})
	return &instance{address: cfg.Server.HTTP, gateway: gateway}, nil
}
