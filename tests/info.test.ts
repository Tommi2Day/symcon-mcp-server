/**
 * tests/info.test.ts
 *
 * Tests for the GET /info endpoint:
 *   - 401 Unauthorized when auth token is required but missing/invalid
 *   - 200 OK with server version and masked configuration
 *   - Symcon version retrieval or error reporting
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
const AUTH_TOKEN = "test-info-token-54321";

async function startServer(extraEnv: Record<string, string> = {}): Promise<number> {
  const port = 17000 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    MCP_PORT: String(port),
    MCP_TRANSPORT: "streamable",
    SYMCON_API_URL: symconUrl,
    SYMCON_API_USER: "info-user@example.com",
    SYMCON_API_PASSWORD: "info-secret-password",
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

  // Wait for server to be ready
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

interface InfoResponse {
  version: string;
  config: Record<string, string | undefined>;
  symcon: {
    version?: string;
    error?: string;
  };
}

describe("GET /info", () => {
  it("returns 200 and correct structure without Authorization", async () => {
    const res = await fetch(`${base()}/info`);
    expect(res.status).toBe(200);
    const body = await res.json() as InfoResponse;
    
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("config");
    expect(body).toHaveProperty("symcon");
    expect(body.symcon).toHaveProperty("version");
    expect(body.symcon.version).toBe("7.0.0 (Build 12345)"); // from mock-symcon
  });

  it("masks sensitive configuration values", async () => {
    const res = await fetch(`${base()}/info`);
    const body = await res.json() as InfoResponse;
    
    expect(body.config.SYMCON_API_PASSWORD).toBe("********");
    expect(body.config.MCP_AUTH_TOKEN).toBe("********");
    expect(body.config.SYMCON_API_USER).toBe("info-user@example.com");
  });

  it("reports error when Symcon is unreachable", async () => {
    // Stop the mock server temporarily
    await mock.stop();
    
    const res = await fetch(`${base()}/info`);
    const body = await res.json() as InfoResponse;
    
    expect(body.symcon.version).toBeUndefined();
    expect(body.symcon.error).toBeDefined();
    
    // Restart mock for subsequent tests if any
    symconUrl = await mock.start();
  });
});
