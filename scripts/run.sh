#!/usr/bin/env bash
# scripts/run.sh
#
# Build and start the symcon-mcp-server Docker container.
# Reads configuration from .env in the project root.
#
# Usage:
#   ./scripts/run.sh                  # start as "symcon-mcp-server"
#   ./scripts/run.sh my-container     # start with custom name
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONTAINER_NAME="${1:-symcon-mcp-server}"
ENV_FILE="$PROJECT_DIR/.env"
TOKEN_FILE="$PROJECT_DIR/auth_token"

# ─── Load .env if present ────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  echo "[run] Loading $ENV_FILE"
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

# ─── Auto-generate AUTH TOKEN on first run ───────────────────────────────────
if [[ -z "${MCP_AUTH_TOKEN:-}" ]]; then
  if [[ -f "$TOKEN_FILE" ]]; then
    MCP_AUTH_TOKEN=$(cat "$TOKEN_FILE")
    echo "[run] Loaded existing auth token from $TOKEN_FILE"
  else
    MCP_AUTH_TOKEN=$(openssl rand -hex 32)
    echo "$MCP_AUTH_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo "[run] Generated new auth token → saved to $TOKEN_FILE"
  fi
fi

MCP_PORT="${MCP_PORT:-4096}"
MCP_HOST_PORT="${MCP_HOST_PORT:-$MCP_PORT}"
SYMCON_API_URL="${SYMCON_API_URL:-http://host.docker.internal:3777/api/}"

# ─── Stop / remove existing container ───────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[run] Stopping existing container: $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# ─── Build image ─────────────────────────────────────────────────────────────
echo "[run] Building Docker image..."
docker build -t symcon-mcp-server "$PROJECT_DIR" --quiet

# ─── Start container ─────────────────────────────────────────────────────────
echo "[run] Starting $CONTAINER_NAME on port $MCP_HOST_PORT..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${MCP_HOST_PORT}:${MCP_PORT}" \
  --add-host=host.docker.internal:host-gateway \
  -e MCP_PORT="$MCP_PORT" \
  -e MCP_TRANSPORT="${MCP_TRANSPORT:-streamable}" \
  -e MCP_AUTH_TOKEN="$MCP_AUTH_TOKEN" \
  -e SYMCON_API_URL="$SYMCON_API_URL" \
  -e SYMCON_API_USER="${SYMCON_API_USER:-}" \
  -e SYMCON_API_PASSWORD="${SYMCON_API_PASSWORD:-}" \
  -e SYMCON_TLS_VERIFY="${SYMCON_TLS_VERIFY:-true}" \
  -e LOG_LEVEL="${LOG_LEVEL:-info}" \
  symcon-mcp-server

# ─── Wait for health ─────────────────────────────────────────────────────────
echo "[run] Waiting for server to become healthy..."
for i in $(seq 1 20); do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
    "http://127.0.0.1:${MCP_HOST_PORT}/health" 2>/dev/null || echo "000")
  if [[ "$STATUS" == "200" || "$STATUS" == "503" ]]; then
    echo "[run] Server is up (HTTP $STATUS)"
    break
  fi
  echo "[run]   Attempt $i/20 (HTTP $STATUS)..."
  sleep 2
done

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Symcon MCP Server started                               ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  MCP URL:    http://127.0.0.1:%-28s║\n" "${MCP_HOST_PORT}/mcp "
printf "║  Health:     http://127.0.0.1:%-28s║\n" "${MCP_HOST_PORT}/health "
printf "║  Symcon:     %-44s║\n" "$SYMCON_API_URL"
printf "║  Auth Token: %-44s║\n" "(saved to $TOKEN_FILE)"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Claude Desktop config:"
echo "  {"
echo "    \"mcpServers\": {"
echo "      \"symcon\": {"
echo "        \"url\": \"http://127.0.0.1:${MCP_HOST_PORT}/mcp\","
echo "        \"headers\": { \"Authorization\": \"Bearer $(cat "$TOKEN_FILE")\" }"
echo "      }"
echo "    }"
echo "  }"
