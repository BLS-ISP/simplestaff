# ============================================
# Nethserver 8 - Module Installer Image
# ============================================
# This image bundles the imageroot (actions, systemd units, hooks)
# and the UI (admin portal config page) for NS8 module installation.

FROM alpine:latest

# Copy imageroot and ui to their NS8-standard root-level directories
COPY imageroot /imageroot
COPY ui /ui

# Nethserver 8 Module metadata labels
LABEL org.nethserver.rootfull="0" \
      org.nethserver.images="docker.io/library/postgres:15-alpine ghcr.io/bls-isp/simplestaff-backend:latest ghcr.io/bls-isp/simplestaff-frontend:latest" \
      org.nethserver.authorizations="traefik@node:routeadm" \
      org.nethserver.tcp-ports-demand="1"

CMD ["/bin/sh"]
