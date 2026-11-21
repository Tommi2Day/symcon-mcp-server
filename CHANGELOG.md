# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased

First stable release, focused on securing the server and testing it against a real IP-Symcon instance.

### ⚠ Breaking changes

- **Authentication is now mandatory.** The server exits at startup when `MCP_AUTH_TOKEN` is empty, unless `MCP_ALLOW_NO_AUTH=true` is set explicitly (the `stdio` transport is exempt). Docker deployments that relied on an empty token must now set one.
- **`/info` requires authentication** (Bearer token or `X-MCP-API-Key`) and returns only an allowlisted set of settings instead of the full process environment.
- **`/health` no longer returns `symcon.url`**, and error details are reduced to a generic message (full details are logged).
- **Default bind address is `127.0.0.1`** (configurable via `MCP_HOST`). The Docker image sets `MCP_HOST=0.0.0.0`, so containers are unaffected.
- **Browser requests are rejected** (HTTP 403) unless their `Origin` is listed in `MCP_ALLOWED_ORIGINS`. Non-browser MCP clients send no `Origin` header and are unaffected.

### Added

- `MCP_ALLOW_NO_AUTH`, `MCP_HOST`, `MCP_ALLOWED_ORIGINS` and `MCP_RATE_LIMIT` environment variables.
- Per-IP rate limiting (default 300 requests/minute, `0` disables) with HTTP 429 responses.
- Origin validation on `/mcp`, `/sse` and `/messages` as DNS-rebinding protection.
- Limits on MCP sessions: at most 100 concurrent sessions, idle sessions expire after 30 minutes.
- 1 MB limit on JSON request bodies.
- 30 second timeout for requests to Symcon and a cap of 8 concurrent Symcon calls (also bounds `symcon_snapshot_variables`).
- Integration tests against the real `symcon/symcon` container covering all 17 MCP tools and the full HTTP server end-to-end (Streamable HTTP client, `/health`, `/info`, auth).
- Security section in `README.md` / `README.de.md`.
- This changelog.

### Changed

- Token comparison is constant-time.
- Session IDs are generated with `crypto.randomUUID()` instead of `Math.random()`.
- `DELETE /mcp` now closes the session transport instead of only removing it from the map.
- `/health` results are cached for 5 seconds to prevent it from being used to hammer Symcon.
- `X-Powered-By` header is disabled.
- `openapi.yaml`, `README.md`, `README.de.md`, `CLAUDE.md` and `docker-compose.yml` updated for the above.

### Security

- Updated dependencies to fix all production `npm audit` findings, including a critical `proxy-addr` IP-spoofing issue and high-severity advisories in `@modelcontextprotocol/sdk`, `body-parser`, `zod`, `ip-address` and `fast-uri`.
- Closed an unauthenticated information disclosure in `/info` that could expose arbitrary container environment variables.
- Closed the default unauthenticated remote-code-execution exposure via `symcon_run_script_text_ex` / `symcon_run_script_text` when no token was configured.

## [0.1.2] - 2026-07-17

### Fixed

- `symcon_run_script_text_ex`: output truncation is now UTF-8 safe (`mb_strcut`) and guards against `json_encode` failures.

## [0.1.1] - 2026-07-16

### Fixed

- `symcon_run_script_text_ex` uses `IPS_RunScriptTextWait` so output is actually captured.

## [0.1.0] - 2026-07-15

### Added

- Script management tools (create, set content, delete, get content).
- `symcon_run_script_text_ex` with structured output, return value and error channels.

### Changed

- `openapi.json` replaced by `openapi.yaml`.

## [0.0.4] - 2026-04-04

## [0.0.3] - 2026-04-04

Initial public releases.

[1.0.0]: https://github.com/Tommi2Day/symcon-mcp-server/compare/0.1.2...1.0.0
[0.1.2]: https://github.com/Tommi2Day/symcon-mcp-server/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/Tommi2Day/symcon-mcp-server/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Tommi2Day/symcon-mcp-server/compare/0.0.4...0.1.0
