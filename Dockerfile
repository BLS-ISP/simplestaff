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

# Copy imageroot (actions, systemd, hooks) and compiled UI
COPY imageroot /imageroot
COPY --from=ui-builder /build/dist /ui

# NethServer 8 Module metadata labels
LABEL org.nethserver.rootfull="0" \
      org.nethserver.images="ghcr.io/bls-isp/simplestaff-backend:latest ghcr.io/bls-isp/simplestaff-frontend:latest" \
      org.nethserver.authorizations="traefik@node:routeadm" \
      org.nethserver.tcp-ports-demand="1"

CMD ["/bin/sh"]
