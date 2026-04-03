# CLAUDE.md – Symcon MCP Server

This file gives Claude and other AI coding assistants the context needed to
work effectively in this repository.

---

## What this project does

`symcon-mcp-server` is a **Docker-based Model Context Protocol (MCP) server**
that exposes the **IP-Symcon smart home platform** (JSON-RPC API) as MCP tools.
AI assistants (Claude, Cursor, VS Code Copilot, …) connect to it via HTTP and
can then read sensor values, control devices, run scripts, and more in the
connected Symcon instance.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (ESM, Node 20+) |
| HTTP server | Express 4 |
| MCP SDK | `@modelcontextprotocol/sdk` ≥ 1.10 |
| Schema validation | Zod |
| Testing | Vitest 2 (unit), Docker (integration) |
| Linting | ESLint 9 + typescript-eslint |
| Container | Docker (multi-stage, alpine) |
| CI/CD | GitHub Actions |

---

## Project layout

```
src/
  index.ts        Express server; mounts Streamable HTTP (/mcp) or SSE (/sse) transport
  symcon.ts       SymconClient – thin wrapper around fetch/https for the JSON-RPC API
  tools.ts        registerTools() – all 15 MCP tool definitions
  logger.ts       Simple stdout/stderr logger with log level

tests/
  helpers/
    mock-symcon.ts     MockSymconServer – in-process HTTP mock for Symcon JSON-RPC
    symcon-docker.ts   Helpers to start/stop a real Symcon Docker container
  symcon-client.test.ts  Unit tests for SymconClient
  tools.test.ts          Unit tests for all MCP tools (via InMemoryTransport)
  http-server.test.ts    HTTP layer tests: /health, auth, /mcp
  integration.test.ts    Integration tests against real Symcon container

scripts/
  run.sh          Build & start Docker container with auto-generated auth token
  test.sh         Run tests (unit or integration) inside Docker
  coverage.sh     Generate and optionally open HTML coverage report
  lint.sh         ESLint via local Node or Docker
  test-health.sh  Smoke-test a running server instance

.github/workflows/
  ci.yml          Lint → Unit tests → Integration tests → Docker build check
  release.yml     Tag/manual dispatch → bump → lint → test → Docker push → GH Release
```

---

## Common development commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run unit tests (fast, no Docker required)
npm test

# Run tests in watch mode
npm run test:watch

# Run integration tests (requires Docker)
npm run test:integration

# Generate coverage report
npm run coverage

# Lint
npm run lint
npm run lint:fix

# Start development server
SYMCON_API_URL=http://192.168.1.100:3777/api/ npm run dev
```

---

## Key files to understand

### `src/symcon.ts` – SymconClient

The `SymconClient` class wraps IP-Symcon's JSON-RPC API. All methods follow
this pattern:

```typescript
async getValue(variableId: number): Promise<unknown> {
  return this.rpc("GetValue", [variableId]);
}
```

`rpc<T>()` is the low-level method. It handles auth headers, TLS, and error
mapping. When `SYMCON_TLS_VERIFY=false`, it falls back to Node's `https` module
with `rejectUnauthorized: false`.

### `src/tools.ts` – MCP tools

`registerTools(server, symcon)` registers all tools on the `McpServer` instance.
Each tool is defined with a Zod schema for input validation and returns MCP
`content` blocks (always `type: "text"` with a JSON string).

**Adding a new tool:**

```typescript
server.tool(
  "symcon_my_new_tool",
  "Description shown to the AI",
  { param: z.string().describe("What this param does") },
  async ({ param }) => {
    const result = await symcon.someMethod(param);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

Always add a corresponding test in `tests/tools.test.ts`.

### `tests/helpers/mock-symcon.ts` – MockSymconServer

Used in unit tests. It's a lightweight `http.Server` that handles JSON-RPC
requests. Use `createDefaultMock()` for the pre-loaded defaults, or
`.on(method, handler)` to override specific methods:

```typescript
mock.on("GetValue", ([id]) => id === 10001 ? true : false);
```

### `tests/tools.test.ts` – MCP tool tests via InMemoryTransport

Tools are tested end-to-end using `InMemoryTransport.createLinkedPair()` from
the MCP SDK – no real HTTP, no real Symcon. This is the recommended pattern for
testing MCP tools.

---

## Symcon API reference

- **`GetValue(variableId)`** – Read current variable value
- **`SetValue(variableId, value)`** – Write value directly (no action handler)
- **`RequestAction(variableId, value)`** – Trigger action handler (use for real devices)
- **`IPS_GetObject(objectId)`** – Metadata about any object
- **`IPS_GetChildrenIDs(objectId)`** – Child IDs (0 = root)
- **`IPS_GetObjectIDByName(name, parentId)`** – Find by name
- **`IPS_GetVariable(variableId)`** – Variable metadata + type
- **`IPS_RunScript(scriptId)`** – Execute script
- **`IPS_RunScriptText(phpCode)`** – Execute arbitrary PHP
- **`IPS_CreateScript(type, name, parentId)`** – Create script (type=0 for PHP)
- **`IPS_SetScriptContent(scriptId, content)`** – Update script code
- **`IPS_DeleteScript(scriptId)`** – Remove script

Object types: `0=Category`, `1=Instance`, `2=Variable`, `3=Script`, `4=Event`,
`5=Media`, `6=Link`

Variable types: `0=Boolean`, `1=Integer`, `2=Float`, `3=String`

---

## Transport modes

| Mode | Env var | Endpoint | Best for |
|------|---------|----------|----------|
| Streamable HTTP (default) | `MCP_TRANSPORT=streamable` | `POST /mcp` | Claude Desktop, modern clients |
| SSE (legacy) | `MCP_TRANSPORT=sse` | `GET /sse` + `POST /messages` | Older Cursor versions |

---

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `MCP_PORT` | `4096` | Container port |
| `MCP_TRANSPORT` | `streamable` | `streamable` or `sse` |
| `MCP_AUTH_TOKEN` | *(empty)* | Empty = no auth |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `SYMCON_API_URL` | `http://host.docker.internal:3777/api/` | |
| `SYMCON_API_USER` | *(empty)* | Basic auth username |
| `SYMCON_API_PASSWORD` | *(empty)* | Basic auth password |
| `SYMCON_TLS_VERIFY` | `true` | `false` = skip cert check |

---

## Test architecture

```
Unit tests (fast, no external deps)
  ├── symcon-client.test.ts  → MockSymconServer (in-process HTTP)
  ├── tools.test.ts          → McpServer + InMemoryTransport + MockSymconServer
  └── http-server.test.ts    → spawns real Express server process

Integration tests (Docker required)
  └── integration.test.ts    → real symcon/symcon-server container
                               (auto-started locally, service in CI)
```

---

## CI pipeline

```
ci.yml:
  lint → unit tests (Node 20 + 22) → integration tests → docker build check

release.yml:
  triggered by semver tag OR manual dispatch
  → bump version → lint → test → build multi-arch image → push to Docker Hub + GHCR → GitHub Release
```

**Required GitHub Secrets:**

| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub login |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `CODECOV_TOKEN` | Coverage reporting (optional) |

---

## Release process

```bash
# Option 1: local tag push
npm version 1.2.3
git push origin main 1.2.3

# Option 2: GitHub UI
# Actions → Release → Run workflow → enter version
```

The `npm version` command calls the `scripts/bump-version.mjs` lifecycle hook
via `"version"` in `package.json`.

---

## Docker image tags

| Tag | Description |
|-----|-------------|
| `1.2.3` | Exact version |
| `1.2` | Latest patch of 1.2 |
| `1` | Latest minor of 1 |
| `latest` | Latest build from main |
| `sha-abc1234` | Specific commit |

Images are published to:
- `tommi2day/symcon-mcp-server` (Docker Hub)
- `ghcr.io/tommi2day/symcon-mcp-server` (GitHub Container Registry)
