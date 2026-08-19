module github.com/lvtuopen-ai/liveshop-gateway/backend

go 1.25.0

require (
	github.com/liveshop-platform/contracts v0.1.0
	github.com/lvtuopen-ai/kernel-go v0.2.0
	gopkg.in/yaml.v3 v3.0.1
)

// Local workspace development uses the adjacent source checkouts. Release CI
// must drop these replacements and resolve the pinned published modules.
replace github.com/liveshop-platform/contracts => ../../../liveshop-protocol/platform

replace github.com/lvtuopen-ai/kernel-go => ../../../kernel-go

require (
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
	golang.org/x/text v0.39.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260526163538-3dc84a4a5aaa // indirect
	google.golang.org/grpc v1.83.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)
