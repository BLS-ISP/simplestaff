# ============================================
# SimpleStaff Frontend - Production Dockerfile
# ============================================

# ── BUILD STAGE ──
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency configs
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Set API URL to relative /api and build
ENV VITE_API_URL=/api
RUN npm run build

# ── RUN STAGE ──
FROM nginx:alpine
WORKDIR /usr/share/nginx/html

# Clean default assets
RUN rm -rf ./*

# Copy built assets from builder
COPY --from=builder /app/dist .

# Copy Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port and start
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
