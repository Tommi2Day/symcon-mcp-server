#!/usr/bin/env bash
# scripts/test.sh
#
# Run unit tests (and optionally integration tests) using Docker.
# No local Node.js installation required.
#
# Usage:
#   ./scripts/test.sh                         # all unit tests
#   ./scripts/test.sh tests/tools.test.ts     # single test file
#   ./scripts/test.sh --integration           # unit + integration (starts Symcon container)
#   ./scripts/test.sh --coverage              # unit tests + coverage report
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="unit"
EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --integration) MODE="integration" ;;
    --coverage)    MODE="coverage" ;;
    *) EXTRA_ARGS+=("$arg") ;;
  esac
done

echo "[test] Building test image with context: ."
# Use MSYS_NO_PATHCONV=1 to prevent path mangling for $PROJECT_DIR
cd "$PROJECT_DIR"
MSYS_NO_PATHCONV=1 docker build -t symcon-mcp-test --target builder . --quiet

SYMCON_NET=""
SYMCON_ENV=""
SYMCON_CONTAINER="symcon-unit-test-$$"

# ─── Integration: start Symcon container ─────────────────────────────────────
if [[ "$MODE" == "integration" ]]; then
  echo "[test] Pulling symcon/symcon:latest..."
  docker pull symcon/symcon:latest --quiet || true

  echo "[test] Starting Symcon test container..."
  # Define default credentials for integration tests
  SYMCON_API_USER="test@symcon.de"
  SYMCON_API_PASSWORD="symcon"

  MSYS_NO_PATHCONV=1 docker run -d \
    --name "$SYMCON_CONTAINER" \
    -e SYMCON_API_USER="$SYMCON_API_USER" \
    -e SYMCON_API_PASSWORD="$SYMCON_API_PASSWORD" \
    --entrypoint /bin/sh \
    symcon/symcon:latest \
    -c 'if [ ! -f /root/.symcon ]; then \
        SYMCON_API_PASSWORD_BASE64=$(echo -n "'"$SYMCON_API_PASSWORD"'" | base64); \
        echo "Licensee='"$SYMCON_API_USER"'" > /root/.symcon; \
        echo "Password=$SYMCON_API_PASSWORD_BASE64" >> /root/.symcon; \
        chmod 600 /root/.symcon; \
        fi; exec /usr/bin/symcon'

  # Wait for Symcon to become ready
  echo "[test] Waiting for Symcon..."
  for i in $(seq 1 30); do
    if MSYS_NO_PATHCONV=1 docker exec "$SYMCON_CONTAINER" \
        bash -c 'exec 3<>/dev/tcp/localhost/3777 && echo -e "GET /api/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3 && cat <&3 | grep -q "HTTP/1.1 200"' 2>/dev/null; then
      echo "[test] Symcon ready after $((i*2))s"
      break
    fi
    sleep 2
  done

  SYMCON_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$SYMCON_CONTAINER")
  SYMCON_ENV="-e SYMCON_TEST_URL=http://${SYMCON_IP}:3777/api/ -e SYMCON_API_USER=$SYMCON_API_USER -e SYMCON_API_PASSWORD=$SYMCON_API_PASSWORD"

  trap 'echo "[test] Removing Symcon container..."; docker rm -f "$SYMCON_CONTAINER" 2>/dev/null || true' EXIT
fi

# ─── Determine npm command ────────────────────────────────────────────────────
case "$MODE" in
  unit)        NPM_CMD="npm test" ;;
  integration) NPM_CMD="npm run test:integration" ;;
  coverage)    NPM_CMD="npm run coverage" ;;
esac

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  NPM_CMD="$NPM_CMD -- ${EXTRA_ARGS[*]}"
fi

# ─── Run tests ───────────────────────────────────────────────────────────────
echo "[test] Running: $NPM_CMD"
# Use MSYS_NO_PATHCONV=1 to prevent path mangling on Windows (Git Bash/MinGW)
# Mounting . (which is $PROJECT_DIR now) instead of $PROJECT_DIR
MSYS_NO_PATHCONV=1 docker run --rm \
  -v ".:/app:ro" \
  -w /app \
  $SYMCON_ENV \
  symcon-mcp-test \
  sh -c "npm ci --silent && $NPM_CMD"

# ─── Copy coverage out if requested ──────────────────────────────────────────
if [[ "$MODE" == "coverage" ]]; then
  echo "[test] Coverage report: $PROJECT_DIR/coverage/index.html"
fi
