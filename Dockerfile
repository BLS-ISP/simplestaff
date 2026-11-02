# ============================================
# Stage 1: Build Vue.js NS8 Cockpit UI
# ============================================
FROM node:18-alpine AS ui-builder

WORKDIR /build
COPY ui/package.json ui/yarn.lock* ./
RUN corepack enable && yarn install
COPY ui/ ./
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN yarn build

# ============================================
# Stage 2: NethServer 8 Module Installer Image
# ============================================
FROM alpine:latest

ARG IMAGE_TAG=latest

# Copy imageroot (actions, systemd, hooks) and compiled UI
COPY imageroot /imageroot
COPY --from=ui-builder /build/dist /ui

# Normalize line endings (strip CRLF), remove any Python bytecode, and enforce executable permissions
RUN find /imageroot -name "__pycache__" -type d -exec rm -rf {} + && \
    find /imageroot -name "*.pyc" -delete && \
    find /imageroot -type f -exec sed -i 's/\r$//' {} + && \
    chmod +x /imageroot/actions/*/[0-9]* /imageroot/update-module.d/* /imageroot/bin/*

# NethServer 8 Module metadata labels
LABEL org.nethserver.rootfull="0" \
      org.nethserver.images="docker.io/library/postgres:15-alpine ghcr.io/bls-isp/simplestaff-backend:${IMAGE_TAG} ghcr.io/bls-isp/simplestaff-frontend:${IMAGE_TAG}" \
      org.nethserver.authorizations="traefik@node:routeadm" \
      org.nethserver.tcp-ports-demand="1"

CMD ["/bin/sh"]
