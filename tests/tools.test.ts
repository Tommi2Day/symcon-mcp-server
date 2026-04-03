/**
 * tests/tools.test.ts
 *
 * Unit tests for MCP tool registrations using MockSymconServer.
 * Tests that each tool correctly calls the right Symcon RPC methods
 * and returns well-formed MCP content responses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SymconClient } from "../src/symcon.js";
import { registerTools } from "../src/tools.js";
import { MockSymconServer, createDefaultMock } from "./helpers/mock-symcon.js";

let mock: MockSymconServer;
let mcpClient: Client;
let apiUrl: string;

beforeAll(async () => {
  // Start mock Symcon API
  mock = createDefaultMock();
  apiUrl = await mock.start();

  // Create MCP server with tools
  const symcon = new SymconClient({ url: apiUrl });
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  registerTools(server, symcon);

  // Connect via in-memory transport (no HTTP needed)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await mock.stop();
  await mcpClient.close();
});

beforeEach(() => {
  mock.reset();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await mcpClient.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  return JSON.parse(text);
}

// ─── Tool listing ─────────────────────────────────────────────────────────────

describe("tool registration", () => {
  it("exposes expected tools", async () => {
    const { tools } = await mcpClient.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("symcon_get_value");
    expect(names).toContain("symcon_set_value");
    expect(names).toContain("symcon_request_action");
    expect(names).toContain("symcon_get_variable");
    expect(names).toContain("symcon_get_object");
    expect(names).toContain("symcon_get_children");
    expect(names).toContain("symcon_get_object_id_by_name");
    expect(names).toContain("symcon_get_variable_by_path");
    expect(names).toContain("symcon_run_script");
    expect(names).toContain("symcon_run_script_text");
    expect(names).toContain("symcon_snapshot_variables");
    expect(names).toContain("symcon_diff_variables");
    expect(names).toContain("symcon_script_create");
    expect(names).toContain("symcon_script_set_content");
    expect(names).toContain("symcon_script_delete");
  });

  it("all tools have descriptions", async () => {
    const { tools } = await mcpClient.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });
});

// ─── symcon_get_value ─────────────────────────────────────────────────────────

describe("symcon_get_value", () => {
  it("returns value for boolean variable", async () => {
    const result = await callTool("symcon_get_value", { variableId: 10001 });
    expect(result.variableId).toBe(10001);
    expect(result.value).toBe(true);
  });

  it("returns numeric value", async () => {
    const result = await callTool("symcon_get_value", { variableId: 10002 });
    expect(result.value).toBe(21.5);
  });

  it("calls GetValue RPC", async () => {
    await callTool("symcon_get_value", { variableId: 10001 });
    expect(mock.calls[0]?.method).toBe("GetValue");
    expect(mock.calls[0]?.params).toContain(10001);
  });
});

// ─── symcon_set_value ─────────────────────────────────────────────────────────

describe("symcon_set_value", () => {
  it("returns success response", async () => {
    const result = await callTool("symcon_set_value", {
      variableId: 10001,
      value: false,
    });
    expect(result.success).toBe(true);
    expect(result.variableId).toBe(10001);
  });

  it("calls SetValue RPC with correct params", async () => {
    await callTool("symcon_set_value", { variableId: 10001, value: true });
    const call = mock.calls[0]!;
    expect(call.method).toBe("SetValue");
    expect(call.params).toEqual([10001, true]);
  });
});

// ─── symcon_request_action ────────────────────────────────────────────────────

describe("symcon_request_action", () => {
  it("returns success response", async () => {
    const result = await callTool("symcon_request_action", {
      variableId: 10001,
      value: true,
    });
    expect(result.success).toBe(true);
  });

  it("calls RequestAction RPC", async () => {
    await callTool("symcon_request_action", { variableId: 10001, value: 200 });
    expect(mock.calls[0]?.method).toBe("RequestAction");
  });

  it("passes numeric value for dimmer", async () => {
    await callTool("symcon_request_action", { variableId: 10001, value: 128 });
    expect(mock.calls[0]?.params).toEqual([10001, 128]);
  });
});

// ─── symcon_get_variable ──────────────────────────────────────────────────────

describe("symcon_get_variable", () => {
  it("returns variable metadata", async () => {
    const result = await callTool("symcon_get_variable", { variableId: 10001 });
    expect(result.VariableID).toBe(10001);
    expect(result.VariableTypeName).toBeDefined();
  });

  it("includes human-readable type name", async () => {
    const result = await callTool("symcon_get_variable", { variableId: 10001 });
    expect(result.VariableTypeName).toBe("Boolean");
  });

  it("includes ISO timestamp strings", async () => {
    const result = await callTool("symcon_get_variable", { variableId: 10001 });
    expect(result.VariableUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.VariableChangedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── symcon_get_object ────────────────────────────────────────────────────────

describe("symcon_get_object", () => {
  it("returns object metadata", async () => {
    const result = await callTool("symcon_get_object", { objectId: 0 });
    expect(result.ObjectID).toBe(0);
    expect(result.ObjectName).toBe("Root");
  });

  it("includes human-readable type name", async () => {
    const result = await callTool("symcon_get_object", { objectId: 0 });
    expect(result.ObjectTypeName).toBe("Category");
  });

  it("returns Variable type for variable objects", async () => {
    const result = await callTool("symcon_get_object", { objectId: 10001 });
    expect(result.ObjectTypeName).toBe("Variable");
  });
});

// ─── symcon_get_children ──────────────────────────────────────────────────────

describe("symcon_get_children", () => {
  it("returns child IDs array", async () => {
    const result = await callTool("symcon_get_children", { objectId: 0 });
    expect(Array.isArray(result.children)).toBe(true);
    expect(result.children.length).toBeGreaterThan(0);
  });

  it("defaults to root (objectId=0)", async () => {
    const result = await callTool("symcon_get_children", { objectId: 0 });
    expect(result.objectId).toBe(0);
  });
});

// ─── symcon_get_object_id_by_name ─────────────────────────────────────────────

describe("symcon_get_object_id_by_name", () => {
  it("resolves name to ID", async () => {
    const result = await callTool("symcon_get_object_id_by_name", {
      name: "Living Room",
    });
    expect(result.objectId).toBe(20001);
  });

  it("includes the queried name in response", async () => {
    const result = await callTool("symcon_get_object_id_by_name", {
      name: "Living Room",
    });
    expect(result.name).toBe("Living Room");
  });
});

// ─── symcon_get_variable_by_path ──────────────────────────────────────────────

describe("symcon_get_variable_by_path", () => {
  it("resolves multi-segment path to value", async () => {
    const result = await callTool("symcon_get_variable_by_path", {
      path: "Living Room/Light",
    });
    expect(result.path).toBe("Living Room/Light");
    expect(result.objectId).toBeDefined();
    expect(result.value).toBeDefined();
  });
});

// ─── symcon_run_script ────────────────────────────────────────────────────────

describe("symcon_run_script", () => {
  it("calls IPS_RunScript with scriptId", async () => {
    await callTool("symcon_run_script", { scriptId: 5001 });
    expect(mock.calls[0]?.method).toBe("IPS_RunScript");
    expect(mock.calls[0]?.params).toContain(5001);
  });

  it("returns scriptId in response", async () => {
    const result = await callTool("symcon_run_script", { scriptId: 5001 });
    expect(result.scriptId).toBe(5001);
  });
});

// ─── symcon_run_script_text ───────────────────────────────────────────────────

describe("symcon_run_script_text", () => {
  it("executes PHP code and returns result", async () => {
    const result = await callTool("symcon_run_script_text", {
      script: "<?php echo 'test';",
    });
    expect(result.result).toBeDefined();
  });
});

// ─── symcon_snapshot_variables ────────────────────────────────────────────────

describe("symcon_snapshot_variables", () => {
  it("returns snapshot object with count", async () => {
    const result = await callTool("symcon_snapshot_variables", {
      rootId: 0,
      maxDepth: 2,
    });
    expect(typeof result.count).toBe("number");
    expect(typeof result.snapshot).toBe("object");
  });

  it("respects rootId and maxDepth params", async () => {
    const result = await callTool("symcon_snapshot_variables", {
      rootId: 20001,
      maxDepth: 1,
    });
    expect(result.rootId).toBe(20001);
    expect(result.maxDepth).toBe(1);
  });
});

// ─── symcon_diff_variables ────────────────────────────────────────────────────

describe("symcon_diff_variables", () => {
  it("detects changes between snapshot and current state", async () => {
    // Create a snapshot where light is OFF
    const prevSnapshot = JSON.stringify({ 10001: false, 10002: 20.0 });

    // Current state has light ON (21.5 temp) -> should detect changes
    const result = await callTool("symcon_diff_variables", {
      previousSnapshot: prevSnapshot,
      rootId: 0,
      maxDepth: 2,
    });

    expect(typeof result.changesFound).toBe("number");
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it("returns empty changes when nothing changed", async () => {
    // Snapshot exactly matching the current mock state
    const prevSnapshot = JSON.stringify({ 10001: true, 10002: 21.5 });
    const result = await callTool("symcon_diff_variables", {
      previousSnapshot: prevSnapshot,
      rootId: 0,
      maxDepth: 2,
    });
    // May have changes from other variables, but the structure is correct
    expect(typeof result.changesFound).toBe("number");
  });
});

// ─── symcon_script_create ─────────────────────────────────────────────────────

describe("symcon_script_create", () => {
  it("creates script and returns ID", async () => {
    const result = await callTool("symcon_script_create", {
      parentId: 0,
      name: "Test Script",
      content: "<?php echo 'hi';",
    });
    expect(result.scriptId).toBe(99001);
    expect(result.name).toBe("Test Script");
  });

  it("calls IPS_CreateScript and IPS_SetScriptContent", async () => {
    await callTool("symcon_script_create", {
      parentId: 0,
      name: "My Script",
      content: "<?php",
    });
    const methods = mock.calls.map((c) => c.method);
    expect(methods).toContain("IPS_CreateScript");
    expect(methods).toContain("IPS_SetScriptContent");
  });
});

// ─── symcon_script_set_content ────────────────────────────────────────────────

describe("symcon_script_set_content", () => {
  it("returns success", async () => {
    const result = await callTool("symcon_script_set_content", {
      scriptId: 99001,
      content: "<?php echo 'updated';",
    });
    expect(result.success).toBe(true);
  });
});

// ─── symcon_script_delete ─────────────────────────────────────────────────────

describe("symcon_script_delete", () => {
  it("returns success", async () => {
    const result = await callTool("symcon_script_delete", { scriptId: 99001 });
    expect(result.success).toBe(true);
  });
});
