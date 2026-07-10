#!/bin/bash

# ============================================
# SimpleStaff - NS8 Module Build Script
# ============================================
# Builds all container images for the NS8 module:
#   1. Backend (Rust API)
#   2. Frontend (Vite + Nginx)
#   3. NS8 Module Installer (imageroot + UI)
#
# Usage:
#   ./build-images.sh              # Build only
#   REPOBASE=ghcr.io/bls-isp ./build-images.sh  # Build with custom registry

set -e

# ── Configuration ──
repobase="${REPOBASE:-ghcr.io/bls-isp}"
images=()

# ── 1. Build Backend Image ──
echo "=== Building SimpleStaff Backend ==="
backend_image="${repobase}/simplestaff-backend"
docker build -t "${backend_image}:latest" ./backend
images+=("${backend_image}")
echo "✓ Backend image built: ${backend_image}:latest"

# ── 2. Build Frontend Image ──
echo "=== Building SimpleStaff Frontend ==="
frontend_image="${repobase}/simplestaff-frontend"
docker build -t "${frontend_image}:latest" ./frontend
images+=("${frontend_image}")
echo "✓ Frontend image built: ${frontend_image}:latest"

# ── 3. Build NS8 Admin UI ──
echo "=== Building NS8 Admin UI ==="
if [ -d ui/node_modules ]; then
    echo "Node modules found, building UI..."
else
    echo "Installing UI dependencies..."
    pushd ui > /dev/null
    corepack enable 2>/dev/null || true
    yarn install 2>/dev/null || npm install
    popd > /dev/null
fi
pushd ui > /dev/null
NODE_OPTIONS=--openssl-legacy-provider yarn build 2>/dev/null || NODE_OPTIONS=--openssl-legacy-provider npx vue-cli-service build
popd > /dev/null
echo "✓ NS8 Admin UI built"

# ── 4. Build NS8 Module Installer Image ──
echo "=== Building NS8 Module Image ==="
module_image="${repobase}/ns8-simplestaff"
docker build -t "${module_image}:latest" .
images+=("${module_image}")
echo "✓ Module image built: ${module_image}:latest"

# ── Output ──
echo ""
echo "=== Build Complete ==="
echo "Images built:"
printf '  %s:latest\n' "${images[@]}"
echo ""
echo "To push all images:"
printf '  docker push %s:latest\n' "${images[@]}"
