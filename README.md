# Symcon MCP Server 🏠

Connects AI assistants to [IP-Symcon](https://www.symcon.de) via the Model Context Protocol (MCP).

[![CI](https://github.com/tommi2day/symcon-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/tommi2day/symcon-mcp-server/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/tommi2day/symcon-mcp-server/graph/badge.svg)](https://codecov.io/gh/tommi2day/symcon-mcp-server)
[![GitHub release](https://img.shields.io/github/v/release/tommi2day/symcon-mcp-server)](https://github.com/tommi2day/symcon-mcp-server/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/tommi2day/symcon-mcp-server)](https://hub.docker.com/r/tommi2day/symcon-mcp-server)

Exposes the Symcon JSON-RPC API as MCP tools so that AI assistants (Claude, Cursor, VS Code Copilot, …) can read and control your smart home.

## Overview

| Mode | Transport | When to use |
|------|-----------|-------------|
| Local (Node.js) | stdio | Development, no Docker |
| Docker / Remote | HTTP or HTTPS | Different host on the network |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `4096` | Port the server listens on |
| `MCP_HOST_PORT` | `4096` | Docker host port |
| `MCP_TRANSPORT` | `streamable` | `streamable`, `sse`, or `stdio` |
| `MCP_AUTH_TOKEN` | *(empty)* | Bearer token; [How to create?](#token-authentication) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SYMCON_API_URL` | `http://host.docker.internal:3777/api/` | Symcon JSON-RPC endpoint |
| `SYMCON_API_USER` | *(empty)* | Symcon username (optional) |
| `SYMCON_API_PASSWORD` | *(empty)* | Symcon password (optional) |
| `SYMCON_TLS_VERIFY` | `true` | Set `false` for self-signed certs |

---

## Docker Hub

The image is available on Docker Hub:

```bash
docker pull tommi2day/symcon-mcp-server:latest
```

### Quick start from Hub (HTTP)

```bash
docker run -d --name symcon-mcp-server \
  -p 4096:4096 \
  -e SYMCON_API_URL=http://192.168.1.100:3777/api/ \
  -e SYMCON_API_PASSWORD=your-symcon-password \
  -e MCP_AUTH_TOKEN=my-secret-token \
  tommi2day/symcon-mcp-server:latest
```

### In docker-compose.yml

```yaml
services:
  symcon-mcp-server:
    image: tommi2day/symcon-mcp-server:latest
    ports:
      - "4096:4096"
    environment:
      - SYMCON_API_URL=http://192.168.1.100:3777/api/
      - SYMCON_API_PASSWORD=your-symcon-password
      - MCP_AUTH_TOKEN=my-secret-token
```

---

## Token Authentication

When running the MCP server as an HTTP/SSE service, it's recommended to set a strong `MCP_AUTH_TOKEN` to prevent unauthorized access to your Symcon instance.

### Automatic creation

If you use the provided `./scripts/run.sh` to start the server, it will automatically generate a strong 32-byte hex token for you on the first run and save it to a file named `auth_token` in the project root.

### Manual creation

You can generate a secure token manually using `openssl` (available on Linux, macOS, and Git Bash for Windows):

```bash
openssl rand -hex 32
```

Then, set this value as the `MCP_AUTH_TOKEN` environment variable in your `.env` file or `docker run` command.

### Usage

When authentication is enabled, all requests to the MCP server must include the following header:

```http
Authorization: Bearer <your-mcp-auth-token>
```

---

## 1 · Local (stdio)

Set `MCP_TRANSPORT=stdio` and run via Node.js or Docker.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "symcon": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "tommi2day/symcon-mcp-server"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "SYMCON_API_URL": "http://192.168.1.100:3777/api/",
        "SYMCON_API_PASSWORD": "your-symcon-password"
      }
    }
  }
}
```

---

## 2 · Docker (HTTP/SSE)

This mode runs the MCP server as a standalone container, exposing an HTTP endpoint for any compatible client.

### Run with Docker

If you have a Symcon instance running elsewhere, run just the MCP server:

```bash
docker run -d --name symcon-mcp-server \
  -p 4096:4096 \
  -e SYMCON_API_URL=http://192.168.1.100:3777/api/ \
  -e MCP_AUTH_TOKEN=my-secret-token \
  tommi2day/symcon-mcp-server:latest
```

### Access with `mcp.json`

To use the server from an MCP client (like Cursor or VS Code), add it to your `mcp.json` configuration:

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

---

## 3 · Docker Compose (Full Stack)

Use this if you want to run both **IP-Symcon** and the **MCP Server** together in a single stack (e.g., for testing or evaluation).

1. **Clone and configure**
   ```bash
   git clone https://github.com/tommi2day/symcon-mcp-server.git
   cd symcon-mcp-server
   cp .env.example .env
   ```
   Edit `.env` and set `SYMCON_API_URL`, `SYMCON_API_PASSWORD`, and `MCP_AUTH_TOKEN`.

2. **Start**
   ```bash
   # Starts both services
   docker compose up -d
   ```

3. **Verify**
   ```bash
   curl http://localhost:4096/health
   ```

4. **Access Symcon GUI**
   Open [http://localhost:3777](http://localhost:3777) in your browser to access the IP-Symcon console.

---

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

---

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

---

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

### Snapshot & Diff (device discovery)
1. AI calls `symcon_snapshot_variables` on the relevant room
2. AI asks: *"Please toggle the device you want to assign, then tell me"*
3. User toggles the device
4. AI calls `symcon_diff_variables` to identify which variable changed

---

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info and available endpoints |
| `/health` | GET | Health check (Symcon reachability, uptime) |
| `/mcp` | POST/GET/DELETE | MCP Streamable HTTP transport |
| `/sse` | GET | MCP SSE transport (if `MCP_TRANSPORT=sse`) |
| `/messages` | POST | SSE message handler |
| Stdio | N/A | MCP Stdio transport (if `MCP_TRANSPORT=stdio`) |

---

## Development & Testing

### Running tests locally

```bash
# Install
npm install

# Unit tests
npm test

# Integration tests (starts a real Symcon Docker container)
npm run test:integration

# All tests
npm run test:all
```

### Using Docker Scripts

```bash
./scripts/test.sh                     # unit tests via Docker
./scripts/test.sh --integration       # unit + integration tests
./scripts/lint.sh                     # lint
```

### Test architecture

| Test suite | File | Dependencies |
|-----------|------|-------------|
| Unit: SymconClient | `tests/symcon-client.test.ts` | MockSymconServer (in-process) |
| Unit: MCP tools | `tests/tools.test.ts` | MockSymconServer + InMemoryTransport |
| Unit: HTTP server | `tests/http-server.test.ts` | MockSymconServer + spawned Express |
| Integration | `tests/integration.test.ts` | Real `symcon/symcon-server` Docker container |

---

## CI/CD

The repository uses two primary GitHub Actions workflows:

**`CI` (`ci.yml`)** – runs on every push and pull request:
1. **Lint**: ESLint checks.
2. **Test**: Unit tests on Node 24.
3. **Coverage**: Unit test coverage calculation.
4. **Integration Tests**: Runs integration tests against a real Symcon Docker service container.
5. **Report**: Uploads coverage results to Codecov.

**`Release` (`release.yml`)** – triggered by a semver tag or manual dispatch:
1. **Bump version** (Manual only): Updates `package.json` and `openapi.json`, commits and pushes to `main`.
2. **Lint & Test**: Runs lint, unit tests with coverage, and integration tests.
3. **Build & Push**: Multi-arch Docker build and push to Docker Hub (`tommi2day/symcon-mcp-server`).
4. **Create Release**: Creates a GitHub tag (if manual) and a GitHub Release with auto-generated notes.

---

## Production Checklist

- [ ] Set a strong `MCP_AUTH_TOKEN`
- [ ] Set `SYMCON_API_PASSWORD` if Symcon has authentication enabled
- [ ] Restrict port 4096 via firewall or only expose via reverse proxy
- [ ] Use HTTPS via a reverse proxy (Traefik, nginx, Caddy) in production
- [ ] Check `/health` from your monitoring system

---

## License

MIT
