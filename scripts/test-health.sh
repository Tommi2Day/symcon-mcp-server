#!/usr/bin/env bash
# scripts/test-health.sh
#
# Smoke-test a running symcon-mcp-server instance.
# Calls /health and /mcp (list tools) and prints the results.
#
# Usage:
#   ./scripts/test-health.sh                           # localhost:4096
#   ./scripts/test-health.sh http://myhost:4096        # custom URL
#   MCP_AUTH_TOKEN=mytoken ./scripts/test-health.sh   # with auth
#
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:4096}"
TOKEN="${MCP_AUTH_TOKEN:-$(cat "$(dirname "$0")/../auth_token" 2>/dev/null || echo "")}"

echo "╔═══════════════════════════════════════════════╗"
echo "║  Symcon MCP Server – Health Check             ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# ─── /health ─────────────────────────────────────────────────────────────────
echo "▶ GET $BASE_URL/health"
HEALTH=$(curl -sf "$BASE_URL/health" 2>/dev/null || echo '{"error":"unreachable"}')
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
echo ""

STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "?")
SYMCON_OK=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('symcon',{}).get('reachable','?'))" 2>/dev/null || echo "?")

echo "  Status:  $STATUS"
echo "  Symcon:  $SYMCON_OK"
echo ""

# ─── /mcp – list tools ───────────────────────────────────────────────────────
AUTH_HEADER=""
[[ -n "$TOKEN" ]] && AUTH_HEADER="-H \"Authorization: Bearer $TOKEN\""

echo "▶ POST $BASE_URL/mcp – tools/list"
TOOLS_RESP=$(curl -sf \
  -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"initialize",
    "params":{
      "protocolVersion":"2024-11-05",
      "capabilities":{},
      "clientInfo":{"name":"health-check","version":"1.0"}
    }
  }' 2>/dev/null || echo '{"error":"request failed"}')

if echo "$TOOLS_RESP" | grep -q '"error"'; then
  echo "  ✗ MCP endpoint returned an error:"
  echo "$TOOLS_RESP" | python3 -m json.tool 2>/dev/null || echo "$TOOLS_RESP"
else
  echo "  ✓ MCP endpoint is responding"
fi

echo ""
echo "Done."
