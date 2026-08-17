# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
# The tree mirrors the checkout layout, because the workspaces resolve the
# shared UI and SDK packages through relative `file:` paths. Flattening it here
# would make the image build succeed only for a path that no developer has.
WORKDIR /workspace/liveshop-gateway/business
COPY --from=platform-packages . /workspace/liveshop-platform/business/packages
COPY package.json package-lock.json ./
COPY packages ./packages
COPY frontend-admin ./frontend-admin
COPY frontend-merch ./frontend-merch
COPY frontend-shop ./frontend-shop
COPY frontend-live ./frontend-live
RUN npm ci
RUN npx --no-install tsc -p /workspace/liveshop-platform/business/packages/host-sdk/tsconfig.json
ARG WORKSPACE
ARG SOURCE_DIR
ARG VITE_GATEWAY_URL=http://127.0.0.1:8081
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
RUN npm run build:runtime && npm run build --workspace="$WORKSPACE" && mkdir -p /out && cp -R "$SOURCE_DIR/dist/." /out/

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
EXPOSE 8080
