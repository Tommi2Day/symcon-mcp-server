# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev=false

# Copy source and build
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL maintainer="your-email@example.com"
LABEL description="Docker-based MCP Server for IP-Symcon"
LABEL org.opencontainers.image.title="symcon-mcp-server"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/your-org/symcon-mcp-server"

# Security: run as non-root
RUN addgroup -S mcpuser && adduser -S mcpuser -G mcpuser

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Set ownership
RUN chown -R mcpuser:mcpuser /app
USER mcpuser

# Environment defaults (override via docker-compose or -e flags)
ENV NODE_ENV=production \
    MCP_PORT=4096 \
    MCP_TRANSPORT=streamable \
    LOG_LEVEL=info \
    SYMCON_API_URL=http://host.docker.internal:3777/api/ \
    SYMCON_API_USER="" \
    SYMCON_API_PASSWORD="" \
    SYMCON_TLS_VERIFY=true \
    MCP_AUTH_TOKEN=""

EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${MCP_PORT}/health || exit 1

CMD ["node", "dist/index.js"]
