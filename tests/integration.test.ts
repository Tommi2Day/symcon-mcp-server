/**
 * tests/integration.test.ts
 *
 * Integration tests against a REAL IP-Symcon Docker container.
 *
 * These tests are skipped automatically when:
 *   - Docker is not available
 *   - SKIP_INTEGRATION=true is set
 *
 * This test uses docker-compose to start a local IP-Symcon instance.
 *
 * Run locally:
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SymconClient } from "../src/symcon.js";
import { registerTools } from "../src/tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYMCON_USER = process.env.SYMCON_API_USER || "test@symcon.de";
const SYMCON_PASS = process.env.SYMCON_API_PASSWORD || "symcon";

const SKIP =
  process.env.SKIP_INTEGRATION === "true" ||
  (!process.env.SYMCON_TEST_URL && !process.env.CI && !process.env.DOCKER_AVAILABLE);

// Set DOCKER_AVAILABLE if you have docker installed locally to run these tests automatically
// or just run with CI=true npm run test:integration

// In CI the service container URL is injected via env; locally we start our own
// const TEST_URL = process.env.SYMCON_TEST_URL || "http://127.0.0.1:3777/api/";

let client: SymconClient;
let apiUrl = "";
let containerInfo: { apiUrl: string } | null = null;

function newClient(url: string): SymconClient {
  return new SymconClient({ url, username: SYMCON_USER, password: SYMCON_PASS });
}

beforeAll(async () => {
  if (SKIP) return;

  // If SYMCON_TEST_URL is provided (CI), use it directly
  if (process.env.SYMCON_TEST_URL) {
    apiUrl = process.env.SYMCON_TEST_URL;
    client = newClient(apiUrl);
    return;
  }

  // Otherwise start Docker container locally
  const { startSymconContainer } = await import("./helpers/symcon-docker.js");
  try {
    containerInfo = await startSymconContainer();
    apiUrl = containerInfo.apiUrl;
    client = newClient(apiUrl);
  } catch (e) {
    console.warn("[integration] Skipping: could not start Symcon container:", e);
    return;
  }
});

afterAll(async () => {
  if (containerInfo) {
    const { stopSymconContainer } = await import("./helpers/symcon-docker.js");
    stopSymconContainer();
  }
});

describe.skipIf(SKIP)("Symcon Integration (real container)", () => {
  it("connects and retrieves kernel version", async () => {
    const version = await client.ping();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    console.log(`[integration] Symcon version: ${version}`);
  });

  it("can get root object (ID 0)", async () => {
    const obj = await client.getObject(0);
    expect(obj.ObjectID).toBe(0);
    expect(typeof obj.ObjectName).toBe("string");
  });

  it("can get children of root", async () => {
    const children = await client.getChildrenIds(0);
    expect(Array.isArray(children)).toBe(true);
    console.log(`[integration] Root has ${children.length} children`);
  });

  it("can take a shallow snapshot", async () => {
    const snapshot = await client.snapshotVariables(0, 2);
    expect(typeof snapshot).toBe("object");
    console.log(
      `[integration] Snapshot captured ${Object.keys(snapshot).length} variables`
    );
  });

  it("kernel version is a valid version string", async () => {
    const version = await client.ping();
    // Symcon version format: "7.0.0 (Build 12345)"
    expect(version).toMatch(/\d+\.\d+/);
  });

  it("can create and delete a test script", async () => {
    const scriptId = await client.createScript(0, "__mcp_test_script__");
    expect(scriptId).toBeGreaterThan(0);

    await client.setScriptContent(scriptId, "<?php // test");
    const deleted = await client.deleteScript(scriptId);
    expect(deleted).toBe(true);
  });
});

// ─── MCP tools against the real container ────────────────────────────────────

type ToolResult = Record<string, unknown>;

describe.skipIf(SKIP)("MCP tools (real Symcon)", () => {
  let mcp: Client;
  const cleanup: number[] = [];

  async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const res = await mcp.callTool({ name, arguments: args });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(res.isError).not.toBe(true);
    return JSON.parse(content[0].text) as ToolResult;
  }

  /** Run PHP in Symcon via the MCP tool and return the parsed result. */
  const php = (script: string) => call("symcon_run_script_text_ex", { script });

  beforeAll(async () => {
    const server = new McpServer({ name: "it-server", version: "1.0.0" });
    registerTools(server, client);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "it-client", version: "1.0.0" });
    await Promise.all([server.connect(st), mcp.connect(ct)]);
  });

  afterAll(async () => {
    for (const id of cleanup.reverse()) {
      try {
        await php(`<?php if (IPS_ObjectExists(${id})) { IPS_DeleteVariable(${id}); }`);
      } catch {
        /* best effort */
      }
    }
    await mcp?.close();
  });

  it("lists all 17 tools", async () => {
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(17);
  });

  it("symcon_get_object / symcon_get_children work on the root", async () => {
    const obj = await call("symcon_get_object", { objectId: 0 });
    expect(JSON.stringify(obj)).toContain("ObjectID");
    const children = await call("symcon_get_children", { objectId: 0 });
    expect(children).toBeTruthy();
  });

  it("symcon_run_script_text_ex captures output and return value", async () => {
    const r = await php("<?php echo 'hello'; return 6 * 7;");
    expect(r.success).toBe(true);
    expect(r.output).toBe("hello");
    expect(r.returnValue).toBe(42);
    expect(r.executionError).toBeNull();
    expect(r.truncated).toBe(false);
  });

  it("symcon_run_script_text_ex reports PHP exceptions in executionError", async () => {
    const r = await php("<?php throw new RuntimeException('boom');");
    expect(r.success).toBe(true);
    expect(r.executionError).toMatchObject({ class: "RuntimeException", message: "boom" });
  });

  it("symcon_run_script_text_ex truncates output without splitting UTF-8", async () => {
    const r = await call("symcon_run_script_text_ex", {
      script: "<?php echo str_repeat('ä', 100);",
      maxOutputBytes: 11, // odd cut inside a 2-byte character
    });
    expect(r.truncated).toBe(true);
    expect(r.executionError).toBeNull();
    expect(r.output).not.toContain("�");
    expect((r.output as string).length).toBeGreaterThan(0);
  });

  it("symcon_run_script_text_ex does not allow quote injection from user code", async () => {
    const r = await php("<?php echo \"'); echo 'pwned\";");
    expect(r.output).toBe("'); echo 'pwned");
  });

  it("variable round trip: create, set, get, get_variable, find by name, snapshot", async () => {
    const name = `__mcp_it_var_${Date.now()}`;
    const created = await php(
      `<?php $id = IPS_CreateVariable(1); IPS_SetName($id, '${name}'); IPS_SetParent($id, 0); return $id;`
    );
    const varId = created.returnValue as number;
    expect(varId).toBeGreaterThan(0);
    cleanup.push(varId);

    await call("symcon_set_value", { variableId: varId, value: 7 });
    expect((await call("symcon_get_value", { variableId: varId })).value).toBe(7);

    const info = await call("symcon_get_variable", { variableId: varId });
    expect(JSON.stringify(info)).toContain(String(varId));

    const byName = await call("symcon_get_object_id_by_name", { name, parentId: 0 });
    expect(JSON.stringify(byName)).toContain(String(varId));

    const snap = await call("symcon_snapshot_variables", { rootId: 0, maxDepth: 2 });
    expect(JSON.stringify(snap)).toContain(String(varId));
  });

  it("script lifecycle: create, set content, read back, run, delete", async () => {
    const created = await call("symcon_script_create", { parentId: 0, name: "__mcp_it_script__" });
    const scriptId = (created.scriptId ?? created.id) as number;
    expect(scriptId).toBeGreaterThan(0);

    const code = "<?php echo 'from-script';";
    await call("symcon_script_set_content", { scriptId, content: code });
    expect((await call("symcon_get_script_content", { scriptId })).content).toBe(code);

    await call("symcon_run_script", { scriptId });

    const del = await call("symcon_script_delete", { scriptId });
    expect(del.success).toBe(true);
  });

  it("surfaces Symcon errors for invalid object IDs", async () => {
    const res = await mcp.callTool({ name: "symcon_get_object", arguments: { objectId: 999999999 } });
    expect(res.isError === true || /error|exist|not/i.test(JSON.stringify(res))).toBe(true);
  });
});

// ─── Full HTTP server -> real Symcon ─────────────────────────────────────────

describe.skipIf(SKIP)("HTTP server end-to-end (real Symcon)", () => {
  const TOKEN = "it-token-" + Math.random().toString(36).slice(2);
  let proc: ChildProcess;
  let port: number;
  const base = () => `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    port = 18000 + Math.floor(Math.random() * 1000);
    proc = spawn("node", ["--import", "tsx/esm", resolve(__dirname, "../src/index.ts")], {
      env: {
        ...process.env,
        MCP_PORT: String(port),
        MCP_TRANSPORT: "streamable",
        MCP_AUTH_TOKEN: TOKEN,
        SYMCON_API_URL: apiUrl,
        SYMCON_API_USER: SYMCON_USER,
        SYMCON_API_PASSWORD: SYMCON_PASS,
        LOG_LEVEL: "error",
      },
      stdio: "pipe",
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(1000) });
        if (r.status === 200 || r.status === 503) return;
      } catch {
        /* not ready */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("server did not start");
  });

  afterAll(async () => {
    await new Promise<void>((done) => {
      if (!proc) return done();
      proc.once("exit", () => done());
      proc.kill();
    });
  });

  it("/health reports ok against real Symcon", async () => {
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; symcon: { status: string; url?: string } };
    expect(body.status).toBe("ok");
    expect(body.symcon.url).toBeUndefined();
  });

  it("/info requires auth and returns the real Symcon version", async () => {
    expect((await fetch(`${base()}/info`)).status).toBe(401);
    const res = await fetch(`${base()}/info`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { symcon: { version?: string }; config: Record<string, string> };
    expect(body.symcon.version).toMatch(/\d+\.\d+/);
    expect(body.config.SYMCON_API_PASSWORD).toBe("********");
    expect(body.config.MCP_AUTH_TOKEN).toBe("********");
  });

  it("/mcp rejects missing and wrong tokens", async () => {
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
    expect((await fetch(`${base()}/mcp`, init)).status).toBe(401);
    const bad = { ...init, headers: { ...init.headers, Authorization: "Bearer wrong" } };
    expect((await fetch(`${base()}/mcp`, bad)).status).toBe(401);
  });

  it("MCP client over Streamable HTTP can list and call tools", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base()}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const c = new Client({ name: "http-it", version: "1.0.0" });
    await c.connect(transport);
    try {
      const { tools } = await c.listTools();
      expect(tools).toHaveLength(17);
      const res = await c.callTool({
        name: "symcon_run_script_text_ex",
        arguments: { script: "<?php return IPS_GetKernelVersion();" },
      });
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text) as ToolResult;
      expect(payload.executionError).toBeNull();
      expect(String(payload.returnValue)).toMatch(/\d+\.\d+/);
    } finally {
      await c.close();
    }
  });
});
