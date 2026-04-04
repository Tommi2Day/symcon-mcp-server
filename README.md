# Symcon MCP Server 🏠

[![CI](https://github.com/tommi2day/symcon-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/tommi2day/symcon-mcp-server/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/tommi2day/symcon-mcp-server/graph/badge.svg)](https://codecov.io/gh/tommi2day/symcon-mcp-server)
[![GitHub release](https://img.shields.io/github/v/release/tommi2day/symcon-mcp-server)](https://github.com/tommi2day/symcon-mcp-server/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/tommi2day/symcon-mcp-server)](https://hub.docker.com/r/tommi2day/symcon-mcp-server)

A Docker-based **Model Context Protocol (MCP) server** for [IP-Symcon](https://www.symcon.de), exposing the Symcon JSON-RPC API as MCP tools so that AI assistants (Claude, Cursor, VS Code Copilot, …) can read and control your smart home.

## Features

- **Streamable HTTP** transport (MCP 1.x standard), **SSE** fallback, and **Stdio** support
- **14 MCP tools** covering variables, objects, scripts, snapshots and diffs
- **`/health` endpoint** for monitoring and container health checks
- **Optional Bearer token** authentication
- **Docker & docker-compose** ready, multi-stage build (slim runtime image)
- Supports HTTP and HTTPS connections to Symcon (with optional TLS bypass for self-signed certs)
- Non-root container user for security
- Structured JSON logging with configurable log level

## Architecture

```
AI Client (Claude / Cursor / …)
        │  HTTP POST /mcp
        ▼
┌─────────────────────────┐
│   symcon-mcp-server     │  :4096
│   (Docker container)    │
│                         │
│  MCP Tools              │
│   ├─ get_value          │
│   ├─ set_value          │
│   ├─ request_action     │
│   ├─ get_variable       │
│   ├─ get_object         │
│   ├─ get_children       │
│   ├─ get_object_by_name │
│   ├─ get_variable_path  │
│   ├─ run_script         │
│   ├─ run_script_text    │
│   ├─ snapshot_variables │
│   ├─ diff_variables     │
│   ├─ script_create      │
│   └─ script_set_content │
└────────────┬────────────┘
             │ JSON-RPC
             ▼
    IP-Symcon  :3777/api/
```

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/your-org/symcon-mcp-server.git
cd symcon-mcp-server
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
SYMCON_API_URL=http://192.168.1.100:3777/api/   # IP of your Symcon instance
SYMCON_API_PASSWORD=your-symcon-password          # if configured
MCP_AUTH_TOKEN=my-secret-token                    # recommended
```

### 2. Start with Docker Compose

```bash
docker compose up -d
```

### 3. Verify

```bash
curl http://localhost:4096/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 12.34,
  "timestamp": "2026-04-03T10:00:00.000Z",
  "latencyMs": 3,
  "symcon": {
    "url": "http://192.168.1.100:3777/api/",
    "reachable": true
  }
}
```

## MCP Client Configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "symcon": {
      "url": "http://localhost:4096/mcp",
      "headers": {
        "Authorization": "Bearer my-secret-token"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "symcon": {
      "url": "http://localhost:4096/mcp"
    }
  }
}
```

> **Note:** Cursor requires HTTP (not HTTPS with self-signed certs). The default Streamable HTTP transport works well.

### SSE mode (legacy clients)

Set `MCP_TRANSPORT=sse` in `.env`, then connect to `http://localhost:4096/sse`.

### Stdio mode (standard CLI)

Set `MCP_TRANSPORT=stdio` in `.env` or as environment variable when running via `node` or `docker run`. This is the default for many local MCP installations.

```json
{
  "mcpServers": {
    "symcon": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "tommi2day/symcon-mcp-server"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "SYMCON_API_URL": "http://192.168.1.100:3777/api/"
      }
    }
  }
}
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `symcon_get_value` | Read the current value of a variable |
| `symcon_set_value` | Write a value directly to a variable |
| `symcon_request_action` | Trigger a device action (use for real devices) |
| `symcon_get_variable` | Get variable metadata (type, profile, timestamps) |
| `symcon_get_object` | Get metadata for any object (category, instance, …) |
| `symcon_get_children` | List child object IDs (0 = root) |
| `symcon_get_object_id_by_name` | Find an object ID by name |
| `symcon_get_variable_by_path` | Resolve a variable by slash-separated path |
| `symcon_run_script` | Execute an existing Symcon script by ID |
| `symcon_run_script_text` | Execute arbitrary PHP code in Symcon |
| `symcon_snapshot_variables` | Snapshot all variable values under a root |
| `symcon_diff_variables` | Detect changes since a previous snapshot |
| `symcon_script_create` | Create a new PHP script in Symcon |
| `symcon_script_set_content` | Update an existing script's PHP content |
| `symcon_script_delete` | Delete a script by ID |

## Device Control Tips

### Switches & relays
```
Use symcon_request_action with value true (on) or false (off)
```

### Philips Hue brightness
```
Use symcon_request_action with value 0–254 (0 = off, 254 = full brightness)
```

### Finding your variable IDs

Ask the AI assistant:
> "Find the object ID of my living room light"

The AI will use `symcon_get_object_id_by_name` or `symcon_get_variable_by_path` to resolve it.

### Snapshot & Diff (device discovery)

When the AI doesn't know which variable corresponds to a device:

1. AI calls `symcon_snapshot_variables` on the relevant room
2. AI asks: *"Please toggle the device you want to assign, then tell me"*
3. User toggles the device
4. AI calls `symcon_diff_variables` to identify which variable changed

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `4096` | Port the server listens on |
| `MCP_HOST_PORT` | `4096` | Docker host port |
| `MCP_TRANSPORT` | `streamable` | `streamable`, `sse`, or `stdio` |
| `MCP_AUTH_TOKEN` | *(empty)* | Bearer token; empty = no auth |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SYMCON_API_URL` | `http://host.docker.internal:3777/api/` | Symcon JSON-RPC endpoint |
| `SYMCON_API_USER` | *(empty)* | Symcon username (optional) |
| `SYMCON_API_PASSWORD` | *(empty)* | Symcon password (optional) |
| `SYMCON_TLS_VERIFY` | `true` | Set `false` for self-signed certs |

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info and available endpoints |
| `/health` | GET | Health check (Symcon reachability, uptime) |
| `/mcp` | POST/GET/DELETE | MCP Streamable HTTP transport |
| `/sse` | GET | MCP SSE transport (if `MCP_TRANSPORT=sse`) |
| `/messages` | POST | SSE message handler |
| Stdio | N/A | MCP Stdio transport (if `MCP_TRANSPORT=stdio`) |

## Building from Source

```bash
npm install
npm run build
npm start
```

For development with hot reload:

```bash
npm run dev
```

## Development & Testing

### Running tests

```bash
# Unit tests (no Docker / no Symcon required)
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run coverage
npm run coverage:open   # also opens HTML report in browser

# Integration tests (starts a real Symcon Docker container)
npm run test:integration

# All tests
npm run test:all
```

### Using the scripts (Docker-only, no local Node.js needed)

```bash
./scripts/test.sh                     # unit tests via Docker
./scripts/test.sh --integration       # unit + integration tests
./scripts/test.sh --coverage          # coverage report
./scripts/lint.sh                     # lint
./scripts/lint.sh --fix               # auto-fix lint issues
./scripts/coverage.sh --open          # coverage + open HTML report
```

### Test architecture

| Test suite | File | Dependencies |
|-----------|------|-------------|
| Unit: SymconClient | `tests/symcon-client.test.ts` | MockSymconServer (in-process) |
| Unit: MCP tools | `tests/tools.test.ts` | MockSymconServer + InMemoryTransport |
| Unit: HTTP server | `tests/http-server.test.ts` | MockSymconServer + spawned Express |
| Integration | `tests/integration.test.ts` | Real `symcon/symcon-server` Docker container |

Integration tests are automatically skipped when Docker is not available.
In CI they run against a service container started by GitHub Actions.

## CI/CD

The repository uses two GitHub Actions workflows:

**`ci.yml`** – runs on every push and pull request:
1. ESLint
2. Unit tests on Node 20 + 22 with coverage upload to Codecov
3. Integration tests against a real Symcon Docker service container
4. Docker build verification

**`release.yml`** – triggered by a semver tag or manual dispatch:
1. (Optional) version bump commit + tag
2. Lint + unit tests
3. Multi-arch Docker build (`linux/amd64`, `linux/arm64`)
4. Push to Docker Hub (`tommi2day/symcon-mcp-server`) and GHCR
5. GitHub Release with auto-generated notes

### Release

```bash
# Option 1: push a git tag
npm version 1.2.3
git push origin main 1.2.3

# Option 2: GitHub UI
# Actions → Release → Run workflow → enter version
```

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `CODECOV_TOKEN` | Codecov.io token (optional) |

```bash
# Set secrets via GitHub CLI
gh secret set DOCKERHUB_USERNAME --repo tommi2day/symcon-mcp-server
gh secret set DOCKERHUB_TOKEN    --repo tommi2day/symcon-mcp-server
```

## Docker Hub

```bash
docker pull tommi2day/symcon-mcp-server:latest
# or from GHCR:
docker pull ghcr.io/tommi2day/symcon-mcp-server:latest
```

| Tag | Description |
|-----|-------------|
| `latest` | Latest build from `main` |
| `1.2.3` | Specific version |
| `1.2` | Latest patch of 1.2 |
| `1` | Latest minor of 1 |
| `sha-abc1234` | Specific commit |

## Creating the GitHub Repository

```bash
# Prerequisites: git + GitHub CLI (https://cli.github.com/)
gh auth login
./scripts/create-github-repo.sh
```

This script initializes git, creates the public repository under `tommi2day`,
sets repository topics, configures branch protection, and prints the secrets
setup instructions.

## Production Checklist

- [ ] Set a strong `MCP_AUTH_TOKEN`
- [ ] Set `SYMCON_API_PASSWORD` if Symcon has authentication enabled
- [ ] Restrict port 4096 via firewall or only expose via reverse proxy
- [ ] Use HTTPS via a reverse proxy (Traefik, nginx, Caddy) in production
- [ ] Check `/health` from your monitoring system

## License

MIT
