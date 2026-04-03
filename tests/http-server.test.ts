/**
 * tests/http-server.test.ts
 *
 * Tests for the Express HTTP layer:
 *   - GET /health
 *   - GET /
 *   - POST /mcp (basic auth checks)
 *   - 401 when auth token is set
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { MockSymconServer, createDefaultMock } from "./helpers/mock-symcon.js";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mock: MockSymconServer;
let symconUrl: string;
let serverProcess: ChildProcess;
let serverPort: number;
const AUTH_TOKEN = "test-token-12345";

async function startServer(extraEnv: Record<string, string> = {}): Promise<number> {
  const port = 14096 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    MCP_PORT: String(port),
    MCP_TRANSPORT: "streamable",
    SYMCON_API_URL: symconUrl,
    MCP_AUTH_TOKEN: AUTH_TOKEN,
    LOG_LEVEL: "error",
    ...extraEnv,
  };

  const entrypoint = resolve(__dirname, "../src/index.ts");
  serverProcess = spawn("node", ["--import", "tsx/esm", entrypoint], {
    env,
    stdio: "pipe",
  });

  serverProcess.on("error", (err) => { throw err; });

  // Poll /health until the server is ready (avoids relying on log output,
  // which is suppressed when LOG_LEVEL=error)
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return port;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server start timeout");
}

beforeAll(async () => {
  mock = createDefaultMock();
  symconUrl = await mock.start();
  serverPort = await startServer();
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!serverProcess) return resolve();
    serverProcess.once("exit", () => resolve());
    serverProcess.kill();
  });
  await mock.stop();
});

const base = () => `http://127.0.0.1:${serverPort}`;

// ─── /health ─────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with ok status", async () => {
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });

  it("includes uptime field", async () => {
    const res = await fetch(`${base()}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime as number).toBeGreaterThan(0);
  });

  it("includes symcon reachability info", async () => {
    const res = await fetch(`${base()}/health`);
    const body = await res.json() as { symcon: { reachable: boolean; url: string } };
    expect(body.symcon.reachable).toBe(true);
    expect(body.symcon.url).toBe(symconUrl);
  });

  it("includes latencyMs", async () => {
    const res = await fetch(`${base()}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.latencyMs).toBe("number");
  });

  it("includes timestamp in ISO format", async () => {
    const res = await fetch(`${base()}/health`);
    const body = await res.json() as { timestamp: string };
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not require auth token", async () => {
    // health endpoint should be public (no auth header)
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
  });

  it("returns 503 when Symcon is unreachable", async () => {
    // Start a second server pointing to an unreachable Symcon
    const badPort = 14096 + Math.floor(Math.random() * 1000) + 500;
    const badEnv = {
      ...process.env,
      MCP_PORT: String(badPort),
      SYMCON_API_URL: "http://127.0.0.1:1/api/",
      MCP_AUTH_TOKEN: "",
      LOG_LEVEL: "error",
    };
    const entrypoint = resolve(__dirname, "../src/index.ts");
    const proc = spawn("node", ["--import", "tsx/esm", entrypoint], {
      env: badEnv,
      stdio: "pipe",
    });

    const deadline2 = Date.now() + 15_000;
    while (Date.now() < deadline2) {
      try {
        const r = await fetch(`http://127.0.0.1:${badPort}/health`, { signal: AbortSignal.timeout(500) });
        if (r.ok || r.status === 503) break;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const res = await fetch(`http://127.0.0.1:${badPort}/health`);
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("degraded");
    proc.kill();
  });
});

// ─── / (root info) ────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("returns 200 with server info", async () => {
    const res = await fetch(`${base()}/`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("Symcon MCP Server");
  });

  it("includes endpoints info", async () => {
    const res = await fetch(`${base()}/`);
    const body = await res.json() as { endpoints: Record<string, string> };
    expect(body.endpoints.health).toBe("/health");
    expect(body.endpoints.mcp).toBe("/mcp");
  });
});

// ─── /mcp (auth) ──────────────────────────────────────────────────────────────

describe("POST /mcp auth", () => {
  it("returns 401 without auth token", async () => {
    const res = await fetch(`${base()}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize" }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid Bearer token", async () => {
    const res = await fetch(`${base()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
        id: 1,
      }),
    });
    // Should not be 401
    expect(res.status).not.toBe(401);
  });

  it("accepts valid X-MCP-API-Key header", async () => {
    const res = await fetch(`${base()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-API-Key": AUTH_TOKEN,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
        id: 1,
      }),
    });
    expect(res.status).not.toBe(401);
  });

  it("rejects wrong token with 401", async () => {
    const res = await fetch(`${base()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
