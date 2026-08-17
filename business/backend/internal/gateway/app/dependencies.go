// Package app assembles Gateway dependencies and owns the process lifecycle.
package app

import (
	"fmt"

	"github.com/lvtuopen-ai/kernel-go/modulesession"
	"github.com/lvtuopen-ai/kernel-go/workloadidentity"
	"github.com/lvtuopen-ai/liveshop-gateway/backend/internal/gateway/config"
)

// Dependencies is the verifier and issuer set assembled for one process. It is
// passed explicitly; there is no process-global accessor.
type Dependencies struct {
	// Capabilities verifies the contribution-scoped Module Capability that
	// Identity issued to the browser for one active Registry revision.
	Capabilities *modulesession.Verifier
	// Workload signs Gateway's own identity towards Platform internal endpoints.
	Workload *workloadidentity.Issuer
}

// NewDependencies builds every credential from validated configuration. Each
// failure names the configuration section that produced it.
func NewDependencies(cfg *config.Config) (Dependencies, error) {
	capabilities, err := modulesession.NewGatewayVerifier(
		map[string]string{cfg.ModuleCapability.KeyID: cfg.ModuleCapability.PublicKey},
		cfg.ModuleCapability.Issuer,
	)
	if err != nil {
		return Dependencies{}, fmt.Errorf("gateway: module_capability public key: %w", err)
	}
	workload, err := workloadidentity.NewIssuer(
		cfg.WorkloadIdentity.PrivateKey,
		cfg.WorkloadIdentity.KeyID,
		cfg.WorkloadIdentity.Issuer,
		gatewayWorkloadSubject,
		platformInternalAudience,
	)
	if err != nil {
		return Dependencies{}, fmt.Errorf("gateway: workload_identity private key: %w", err)
	}
	return Dependencies{Capabilities: capabilities, Workload: workload}, nil
}

const (
	gatewayWorkloadSubject   = "liveshop-gateway"
	platformInternalAudience = "liveshop-platform-internal"
)
