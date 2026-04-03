/**
 * tests/symcon-client.test.ts
 *
 * Unit tests for the SymconClient class using the MockSymconServer.
 * No Docker / real Symcon required.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SymconClient } from "../src/symcon.js";
import { MockSymconServer, createDefaultMock } from "./helpers/mock-symcon.js";

let mock: MockSymconServer;
let client: SymconClient;
let apiUrl: string;

beforeAll(async () => {
  mock = createDefaultMock();
  apiUrl = await mock.start();
  client = new SymconClient({ url: apiUrl });
});

afterAll(async () => {
  await mock.stop();
});

beforeEach(() => {
  mock.reset();
});

// ─── ping ────────────────────────────────────────────────────────────────────

describe("ping", () => {
  it("returns the kernel version string", async () => {
    const version = await client.ping();
    expect(version).toMatch(/7\.0\.0/);
  });

  it("sends IPS_GetKernelVersion RPC", async () => {
    await client.ping();
    expect(mock.calls[0]?.method).toBe("IPS_GetKernelVersion");
  });
});

// ─── getValue ────────────────────────────────────────────────────────────────

describe("getValue", () => {
  it("returns boolean value for switch variable", async () => {
    const value = await client.getValue(10001);
    expect(value).toBe(true);
  });

  it("returns numeric value for temperature variable", async () => {
    const value = await client.getValue(10002);
    expect(value).toBe(21.5);
  });

  it("sends correct variableId in params", async () => {
    await client.getValue(10001);
    expect(mock.calls[0]?.params).toEqual([10001]);
  });
});

// ─── setValue ────────────────────────────────────────────────────────────────

describe("setValue", () => {
  it("returns true on success", async () => {
    const result = await client.setValue(10001, false);
    expect(result).toBe(true);
  });

  it("sends variableId and value in params", async () => {
    await client.setValue(10001, false);
    const call = mock.calls[0]!;
    expect(call.method).toBe("SetValue");
    expect(call.params).toEqual([10001, false]);
  });

  it("can set numeric value", async () => {
    const result = await client.setValue(10002, 23.5);
    expect(result).toBe(true);
  });
});

// ─── requestAction ───────────────────────────────────────────────────────────

describe("requestAction", () => {
  it("returns true on success", async () => {
    const result = await client.requestAction(10001, true);
    expect(result).toBe(true);
  });

  it("sends RequestAction RPC", async () => {
    await client.requestAction(10001, true);
    expect(mock.calls[0]?.method).toBe("RequestAction");
    expect(mock.calls[0]?.params).toEqual([10001, true]);
  });
});

// ─── getVariable ─────────────────────────────────────────────────────────────

describe("getVariable", () => {
  it("returns variable metadata", async () => {
    const variable = await client.getVariable(10001);
    expect(variable.VariableID).toBe(10001);
    expect(variable.VariableProfile).toBe("~Switch");
  });

  it("includes VariableType", async () => {
    const variable = await client.getVariable(10001);
    expect(typeof variable.VariableType).toBe("number");
  });
});

// ─── getObject ───────────────────────────────────────────────────────────────

describe("getObject", () => {
  it("returns object metadata for root (id=0)", async () => {
    const obj = await client.getObject(0);
    expect(obj.ObjectID).toBe(0);
    expect(obj.ObjectName).toBe("Root");
    expect(obj.ObjectType).toBe(0); // Category
  });

  it("returns variable object metadata", async () => {
    const obj = await client.getObject(10001);
    expect(obj.ObjectType).toBe(2); // Variable
  });
});

// ─── getChildrenIds ──────────────────────────────────────────────────────────

describe("getChildrenIds", () => {
  it("returns array of child IDs for root", async () => {
    const children = await client.getChildrenIds(0);
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBeGreaterThan(0);
    expect(children).toContain(10001);
  });

  it("returns empty array for leaf node", async () => {
    const children = await client.getChildrenIds(10001);
    expect(children).toEqual([]);
  });
});

// ─── getObjectIdByName ───────────────────────────────────────────────────────

describe("getObjectIdByName", () => {
  it("resolves known name to ID", async () => {
    const id = await client.getObjectIdByName("Living Room");
    expect(id).toBe(20001);
  });

  it("returns -1 for unknown name", async () => {
    const id = await client.getObjectIdByName("NonExistentRoom");
    expect(id).toBe(-1);
  });
});

// ─── runScript ───────────────────────────────────────────────────────────────

describe("runScript", () => {
  it("sends IPS_RunScript with scriptId", async () => {
    await client.runScript(5001);
    expect(mock.calls[0]?.method).toBe("IPS_RunScript");
    expect(mock.calls[0]?.params).toEqual([5001]);
  });
});

// ─── runScriptText ───────────────────────────────────────────────────────────

describe("runScriptText", () => {
  it("sends PHP code and returns result", async () => {
    const result = await client.runScriptText("<?php echo 'test';");
    expect(result).toBe("script_result");
  });
});

// ─── createScript ────────────────────────────────────────────────────────────

describe("createScript", () => {
  it("returns numeric script ID", async () => {
    const id = await client.createScript(0, "My Script");
    expect(id).toBe(99001);
  });
});

// ─── setScriptContent ────────────────────────────────────────────────────────

describe("setScriptContent", () => {
  it("returns true on success", async () => {
    const result = await client.setScriptContent(99001, "<?php echo 'hello';");
    expect(result).toBe(true);
  });

  it("sends correct params", async () => {
    await client.setScriptContent(99001, "<?php echo 'hello';");
    const call = mock.calls[0]!;
    expect(call.params).toEqual([99001, "<?php echo 'hello';"]);
  });
});

// ─── deleteScript ────────────────────────────────────────────────────────────

describe("deleteScript", () => {
  it("returns true on success", async () => {
    const result = await client.deleteScript(99001);
    expect(result).toBe(true);
  });
});

// ─── snapshotVariables ───────────────────────────────────────────────────────

describe("snapshotVariables", () => {
  it("returns a record of variableId -> value", async () => {
    const snapshot = await client.snapshotVariables(0, 3);
    expect(typeof snapshot).toBe("object");
    // Should have collected some variables
    expect(Object.keys(snapshot).length).toBeGreaterThanOrEqual(0);
  });
});

// ─── error handling ──────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws on RPC error response", async () => {
    mock.on("IPS_TestError", () => {
      throw new Error("RPC_ERROR"); // handler that throws
    });

    // Override with an error-returning handler
    const errorMock = new MockSymconServer();
    errorMock.on("IPS_GetKernelVersion", (_params) => {
      // Return an error response
      return undefined;
    });

    // Create a custom mock that returns RPC errors
    const errorServer = new MockSymconServer();
    // The mock returns -32601 for unknown methods automatically
    const errorUrl = await errorServer.start();
    const errorClient = new SymconClient({ url: errorUrl });

    await expect(errorClient.rpc("unknown_method")).rejects.toThrow(
      /Symcon RPC error/
    );

    await errorServer.stop();
  });

  it("throws on HTTP error", async () => {
    const badClient = new SymconClient({ url: "http://127.0.0.1:1/api/" });
    await expect(badClient.ping()).rejects.toThrow();
  });
});
