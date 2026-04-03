#!/usr/bin/env bash
# scripts/lint.sh
#
# Run ESLint on all TypeScript source files.
#
# Usage:
#   ./scripts/lint.sh         # check
#   ./scripts/lint.sh --fix   # auto-fix
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

FIX=""
for arg in "$@"; do
  [[ "$arg" == "--fix" ]] && FIX="--fix"
done

if ! command -v node &>/dev/null; then
  echo "[lint] Node.js not found. Building Docker image..."
  docker build -t symcon-mcp-test --target builder "$PROJECT_DIR" --quiet
  docker run --rm -v "$PROJECT_DIR:/app:ro" -w /app symcon-mcp-test \
    sh -c "npm ci --silent && npm run lint $FIX"
  exit $?
fi

npm ci --silent
# shellcheck disable=SC2086
npm run lint $FIX
