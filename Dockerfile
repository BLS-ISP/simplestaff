# ============================================
# Nethserver 8 - Module Installer Image
# ============================================
# Built with buildah-like approach: scratch image + imageroot + built UI
# The GitHub Action builds the Vue.js UI and copies the dist output.

FROM alpine:latest

# Copy imageroot (actions, systemd, hooks) and built UI (from dist/)
COPY imageroot /imageroot
COPY ui/dist /ui

# Nethserver 8 Module metadata labels
LABEL org.nethserver.rootfull="0" \
      org.nethserver.images="docker.io/library/postgres:15-alpine ghcr.io/bls-isp/simplestaff-backend:latest ghcr.io/bls-isp/simplestaff-frontend:latest" \
      org.nethserver.authorizations="traefik@node:routeadm" \
      org.nethserver.tcp-ports-demand="1"

CMD ["/bin/sh"]
