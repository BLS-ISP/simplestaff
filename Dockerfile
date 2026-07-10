# ============================================
# Nethserver 8 - Module Installer Alpine Image
# ============================================

FROM alpine:latest
COPY imageroot /

# Nethserver 8 Module metadata labels
LABEL org.nethserver.rootfull="0" \
      org.nethserver.images="docker.io/library/postgres:15-alpine ghcr.io/bls-isp/simplestaff-backend:latest ghcr.io/bls-isp/simplestaff-frontend:latest" \
      org.nethserver.authorizations="traefik@node:routeadm"
