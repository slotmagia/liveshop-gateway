package app

import (
	"context"

	"github.com/lvtuopen-ai/kernel-go/logctx"
)

func Run(ctx context.Context, configPath string) error {
	current, err := bootstrap(configPath)
	if err != nil {
		return err
	}
	logctx.FromContext(ctx).Info("gateway listening", "address", current.address)
	return current.gateway.Run(ctx, current.address)
}
