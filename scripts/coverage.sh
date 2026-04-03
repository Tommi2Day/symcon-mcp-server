#!/usr/bin/env bash
# scripts/coverage.sh
#
# Generate code coverage report.
# Requires local Node.js 20+ OR use ./scripts/test.sh --coverage for Docker-only.
#
# Usage:
#   ./scripts/coverage.sh           # generate report in ./coverage/
#   ./scripts/coverage.sh --open    # generate and open HTML report in browser
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OPEN=false
for arg in "$@"; do
  [[ "$arg" == "--open" ]] && OPEN=true
done

cd "$PROJECT_DIR"

if ! command -v node &>/dev/null; then
  echo "[coverage] Node.js not found locally. Using Docker..."
  exec "$SCRIPT_DIR/test.sh" --coverage
fi

echo "[coverage] Installing dependencies..."
npm ci --silent

echo "[coverage] Generating coverage report..."
npm run coverage

echo "[coverage] Report written to: $PROJECT_DIR/coverage/"
echo "[coverage] Text summary:"
cat coverage/coverage-summary.json 2>/dev/null || true

if $OPEN; then
  REPORT="$PROJECT_DIR/coverage/index.html"
  if [[ -f "$REPORT" ]]; then
    case "$(uname -s)" in
      Darwin) open "$REPORT" ;;
      Linux)  xdg-open "$REPORT" 2>/dev/null || echo "Open: $REPORT" ;;
      *)      echo "Open: $REPORT" ;;
    esac
  fi
fi
