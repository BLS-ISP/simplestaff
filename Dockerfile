# ============================================
# NethServer 8 Module Installer Image
# ============================================
FROM alpine:latest

ARG IMAGE_TAG=latest

# Copy imageroot (actions, systemd, hooks) and compiled UI (built in CI)
COPY imageroot /imageroot
COPY ui/dist /ui

# Normalize line endings (strip CRLF), remove any Python bytecode, enforce executable permissions,
# and create legacy chunk aliases so cached iframe index.html files never 404 after update-module
RUN find /imageroot -name "__pycache__" -type d -prune -exec rm -rf {} + && \
    find /imageroot -name "*.pyc" -delete && \
    find /imageroot -type f -exec sed -i 's/\r$//' {} + && \
    chmod +x /imageroot/actions/*/[0-9]* /imageroot/update-module.d/* /imageroot/bin/* && \
    APP_JS=$(ls /ui/js/app~*.js 2>/dev/null | head -n 1) && \
    if [ -n "$APP_JS" ]; then \
        for h in eaa6c3bf 5d0d7498 a5beeca5 07ea1448 e2eea686; do \
            target="/ui/js/app~748942c6.${h}.js"; \
            [ "$APP_JS" != "$target" ] && cp "$APP_JS" "$target" || true; \
        done; \
    fi && \
    VENDOR_JS=$(ls /ui/js/chunk-vendors~253ae210.*.js 2>/dev/null | head -n 1) && \
    if [ -n "$VENDOR_JS" ]; then \
        for h in 412c6680 9a6e8ced; do \
            target="/ui/js/chunk-vendors~253ae210.${h}.js"; \
            [ "$VENDOR_JS" != "$target" ] && cp "$VENDOR_JS" "$target" || true; \
        done; \
    fi && \
    APP_CSS=$(ls /ui/css/app~*.css 2>/dev/null | head -n 1) && \
    if [ -n "$APP_CSS" ]; then \
        for h in 1f285f87 8483620a 5d6eeabc; do \
            target="/ui/css/app~748942c6.${h}.css"; \
            [ "$APP_CSS" != "$target" ] && cp "$APP_CSS" "$target" || true; \
        done; \
    fi

# NethServer 8 Module metadata labels
LABEL org.nethserver.rootfull="0" \
      org.nethserver.images="ghcr.io/bls-isp/simplestaff-backend:${IMAGE_TAG} ghcr.io/bls-isp/simplestaff-frontend:${IMAGE_TAG}" \
      org.nethserver.authorizations="traefik@node:routeadm" \
      org.nethserver.tcp-ports-demand="1"

CMD ["/bin/sh"]
