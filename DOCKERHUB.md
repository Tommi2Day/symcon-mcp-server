# Symcon MCP Server

Connects AI assistants (Claude, Cursor, VS Code Copilot, …) to [IP-Symcon](https://www.symcon.de) via the Model Context Protocol (MCP): read sensors, control devices, run scripts — through the Symcon JSON-RPC API.

**Source, full documentation:** [github.com/Tommi2Day/symcon-mcp-server](https://github.com/Tommi2Day/symcon-mcp-server) · **Changelog:** [CHANGELOG.md](https://github.com/Tommi2Day/symcon-mcp-server/blob/main/CHANGELOG.md)

## Features

- **17 MCP tools**: read and write variables, trigger device actions, browse objects, snapshot and diff variables, manage and run scripts, run PHP with structured output (`output`, `returnValue`, `executionError`)
- Streamable HTTP (default) or legacy SSE transport, plus stdio for local use
- **Secure by default**: Bearer-token authentication is mandatory (constant-time comparison), the server refuses to start without a token, `/info` requires the token, browser `Origin` checks against DNS rebinding, per-IP rate limit, session and body limits, timeouts for Symcon calls
- Container runs as non-root; the image contains only Node.js (no npm) and is scanned with Trivy before every release
- Tested against a real IP-Symcon container in CI (all tools and the full HTTP server)
- Images on Docker Hub and the GitHub Container Registry (`ghcr.io/tommi2day/symcon-mcp-server`)

> **Warning:** the tools can run arbitrary PHP in Symcon. Always set a strong `MCP_AUTH_TOKEN` and do not expose the port to untrusted networks.

## Quick start

The Symcon JSON-RPC API requires authentication: use your license e-mail and password.

```bash
export MCP_AUTH_TOKEN=$(openssl rand -hex 32)
echo "Your MCP token: $MCP_AUTH_TOKEN"

docker run -d --name symcon-mcp-server \
  -p 4096:4096 \
  -e MCP_AUTH_TOKEN \
  -e SYMCON_API_URL=http://host.docker.internal:3777/api/ \
  -e SYMCON_API_USER=you@example.com \
  -e SYMCON_API_PASSWORD=your-symcon-password \
  tommi2day/symcon-mcp-server:latest
```

- MCP endpoint: `http://<HOST>:4096/mcp` · Health: `/health` · Info (token required): `/info`
- Keep the generated token — MCP clients need it
- On Linux add `--add-host=host.docker.internal:host-gateway` if Symcon runs on the Docker host
- The container is `healthy` only while Symcon is reachable (`/health` returns 503 otherwise)

Connect a client (e.g. Claude Code):

```bash
claude mcp add --transport http symcon http://localhost:4096/mcp \
  --header "Authorization: Bearer <TOKEN>"
```

Docker Compose:

```yaml
services:
  symcon-mcp-server:
    image: tommi2day/symcon-mcp-server:latest
    ports:
      - "4096:4096"
    environment:
      - MCP_AUTH_TOKEN=change-me
      - SYMCON_API_URL=http://host.docker.internal:3777/api/
      - SYMCON_API_USER=you@example.com
      - SYMCON_API_PASSWORD=your-symcon-password
```

## Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest release |
| `1.2.3` | Specific version |
| `1.2` | Latest patch of 1.2 |
| `1` | Latest minor of 1 |
| `sha-abc1234` | Specific commit |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `4096` | Port the server listens on |
| `MCP_HOST` | `0.0.0.0` (image) | Bind address (`127.0.0.1` outside Docker) |
| `MCP_TRANSPORT` | `streamable` | `streamable`, `sse` or `stdio` |
| `MCP_AUTH_TOKEN` | – | **Required.** Bearer token (`Authorization: Bearer …` or `X-MCP-API-Key`). The server exits at startup if empty |
| `MCP_ALLOW_NO_AUTH` | `false` | `true` allows starting without a token (not recommended) |
| `MCP_ALLOWED_ORIGINS` | – | Comma-separated browser origins allowed to call `/mcp`; requests with other `Origin` get 403 |
| `MCP_RATE_LIMIT` | `300` | Max requests per minute per IP (`0` = off) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `SYMCON_API_URL` | `http://host.docker.internal:3777/api/` | Symcon [JSON-RPC endpoint](https://www.symcon.de/en/service/documentation/developer-area/data-exchange/) |
| `SYMCON_API_USER` | – | Symcon license e-mail (required) |
| `SYMCON_API_PASSWORD` | – | Symcon password (required) |
| `SYMCON_TLS_VERIFY` | `true` | `false` skips certificate checks (self-signed certs; allows man-in-the-middle attacks) |

More options and the German README: see the [full README](https://github.com/Tommi2Day/symcon-mcp-server#readme).

## MCP tools

| Tool | Description |
|------|-------------|
| `symcon_get_value` | Read the current value of a variable |
| `symcon_set_value` | Write a value directly to a variable |
| `symcon_request_action` | Trigger a device action (use for real devices) |
| `symcon_get_variable` | Variable metadata (type, profile, timestamps) |
| `symcon_get_object` | Metadata for any object (category, instance, …) |
| `symcon_get_children` | List child object IDs (0 = root) |
| `symcon_get_object_id_by_name` | Find an object ID by name |
| `symcon_get_variable_by_path` | Resolve a variable by slash-separated path |
| `symcon_snapshot_variables` | Snapshot all variable values under a root |
| `symcon_diff_variables` | Detect changes since a previous snapshot |
| `symcon_run_script` | Execute an existing Symcon script by ID |
| `symcon_run_script_text` | Execute arbitrary PHP code (asynchronous) |
| `symcon_run_script_text_ex` | Execute PHP and return output, return value and errors as separate fields; output is byte-capped |
| `symcon_get_script_content` | Read the PHP source of a script (read-only) |
| `symcon_script_create` | Create a new PHP script |
| `symcon_script_set_content` | Update a script's PHP content |
| `symcon_script_delete` | Delete a script by ID |

## Security

- Authentication is mandatory; restrict the published port with a firewall or reverse proxy and use HTTPS (Traefik, nginx, Caddy) outside trusted networks
- `/health` is public (for Docker health checks) but exposes no URLs or error details; `/info` requires the token
- Limits: 100 concurrent MCP sessions (idle sessions expire after 30 minutes), 1 MB request bodies, 30 s timeout and at most 8 concurrent calls to Symcon
- The default `http://` Symcon URL sends credentials unencrypted — use HTTPS on untrusted networks

Details: [Security](https://github.com/Tommi2Day/symcon-mcp-server#security) · License (Apache 2.0) and issues: [GitHub](https://github.com/Tommi2Day/symcon-mcp-server)
