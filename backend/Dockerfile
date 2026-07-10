# ============================================
# SimpleStaff Backend - Production Dockerfile
# ============================================

# ── BUILD STAGE ──
FROM rust:1.95-slim AS builder
WORKDIR /app

# Install compilation packages
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Rust backend code
COPY . .

# Compile Rust release binary & seed binary
RUN cargo build --release

# ── RUN STAGE ──
FROM debian:bookworm-slim
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy binaries from builder
COPY --from=builder /app/target/release/simplestaff-backend /app/backend
COPY --from=builder /app/target/release/seed_demo /app/seed_demo

# Expose port and start
EXPOSE 8080
ENV RUST_LOG=info
CMD ["/app/backend"]
