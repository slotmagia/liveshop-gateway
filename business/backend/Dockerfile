# syntax=docker/dockerfile:1.7
FROM golang:1.25-alpine AS build
WORKDIR /workspace
COPY --from=protocol . ./protocol
COPY --from=kernel . ./kernel-go
COPY . ./liveshop-gateway/backend
WORKDIR /workspace/liveshop-gateway/backend
RUN go mod edit \
      -replace=github.com/liveshop-platform/contracts=/workspace/protocol \
      -replace=github.com/lvtuopen-ai/kernel-go=/workspace/kernel-go && \
    CGO_ENABLED=0 go build -trimpath -o /out/gateway ./internal/gateway/cmd
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/gateway /app/gateway
COPY --from=build /workspace/liveshop-gateway/backend/configs /app/configs
WORKDIR /app
USER nonroot:nonroot
ENTRYPOINT ["/app/gateway"]
