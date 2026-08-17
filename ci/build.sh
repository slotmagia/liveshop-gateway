#!/usr/bin/env bash
set -Eeuo pipefail
bash ci/prepare-contexts.sh
workspace_root="$(cd "$(dirname "$CI_PROJECT_DIR")" && pwd -P)"
tag="$CI_COMMIT_SHA-$CI_PIPELINE_ID"
trap 'docker logout "$CI_REGISTRY" >/dev/null 2>&1 || true' EXIT
printf '%s' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin
docker buildx build --pull --push   --build-context "kernel=$workspace_root/kernel-go"   --build-context "protocol=$workspace_root/liveshop-platform/protocol"   --file "$CI_PROJECT_DIR/business/backend/Dockerfile"   --tag "$CI_REGISTRY_IMAGE/backend:$tag"   "$CI_PROJECT_DIR/business/backend"
for surface in admin merch shop live; do
  docker buildx build --pull --push     --build-context "platform-packages=$workspace_root/liveshop-platform/business/packages"     --build-arg "WORKSPACE=@liveshop/app-$surface"     --build-arg "SOURCE_DIR=frontend-$surface"     --build-arg 'VITE_GATEWAY_URL=http://192.168.5.140:18081'     --file "$CI_PROJECT_DIR/business/deploy/frontend.Dockerfile"     --tag "$CI_REGISTRY_IMAGE/frontend-$surface:$tag"     "$CI_PROJECT_DIR/business"
done

