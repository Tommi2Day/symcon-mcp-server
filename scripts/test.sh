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
COMPOSE_FILE="docker/docker-compose.test.yml"

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

SYMCON_ENV=""

# ─── Integration: start Symcon container via docker-compose ───────────────────
if [[ "$MODE" == "integration" ]]; then
  echo "[test] Starting Symcon container via docker-compose..."
  MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE_FILE" down --volumes 2>/dev/null || true
  MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE_FILE" up -d --wait

  # Get container IP for internal communication within Docker if needed, 
  # but here we run tests from another container, so they should probably be on the same network.
  # However, scripts/test.sh currently runs the test container without being on the same network as the compose services.
  # Docker Compose creates its own network.
  
  # For simplicity, we can just use host networking for the test container or join the compose network.
  # But the current script uses 127.0.0.1 if SYMCON_TEST_URL is not set.
  # Let's check how the test container should talk to Symcon.
  
  SYMCON_ENV="-e SYMCON_TEST_URL=http://host.docker.internal:3777/api/ -e DOCKER_AVAILABLE=true"
  
  trap 'echo "[test] Stopping Symcon container..."; MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE_FILE" down --volumes 2>/dev/null || true' EXIT
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
  --add-host=host.docker.internal:host-gateway \
  $SYMCON_ENV \
  symcon-mcp-test \
  sh -c "npm ci --silent && $NPM_CMD"

# ─── Copy coverage out if requested ──────────────────────────────────────────
if [[ "$MODE" == "coverage" ]]; then
  echo "[test] Coverage report: $PROJECT_DIR/coverage/index.html"
fi
