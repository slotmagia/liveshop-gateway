package main

import (
	"context"
	"flag"
	"os"
	"strings"

	"github.com/lvtuopen-ai/kernel-go/lifecycle"
	"github.com/lvtuopen-ai/kernel-go/logctx"
	"github.com/lvtuopen-ai/liveshop-gateway/backend/internal/gateway/app"
	"github.com/lvtuopen-ai/liveshop-gateway/backend/internal/gateway/config"
)

func main() {
	configPath := flag.String("config", "./configs/gateway.yaml", "path to YAML config")
	flag.Parse()

	// Logging is configured from the same file as everything else, so the
	// process has exactly one source of runtime configuration.
	cfg, err := config.Load(*configPath)
	if err != nil {
		logctx.Configure(logctx.Options{Service: "gateway", Level: "info"})
		logctx.FromContext(context.Background()).Error("gateway configuration is invalid", "error", err)
		os.Exit(1)
	}
	logctx.Configure(logctx.Options{
		Service: cfg.Service,
		Level:   cfg.Log.Level,
		JSON:    strings.EqualFold(cfg.Log.Format, "json"),
	})
	ctx, cancel := lifecycle.SignalContext(context.Background())
	defer cancel()
	if err := app.Run(ctx, *configPath); err != nil {
		logctx.FromContext(ctx).Error("gateway stopped with an error", "error", err)
		os.Exit(1)
	}
}
