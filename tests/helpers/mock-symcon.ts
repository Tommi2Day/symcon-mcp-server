/**
 * tests/helpers/mock-symcon.ts
 *
 * A mock HTTP server that mimics the Symcon JSON-RPC API for unit tests.
 * No Docker required – fast and fully offline.
 */

import http from "http";
import type { AddressInfo } from "net";

export interface MockRpcHandler {
  method: string;
  handler: (params: unknown[]) => unknown;
}

interface RpcRequest {
  jsonrpc: string;
  method: string;
  params: unknown[];
  id: number;
}

export class MockSymconServer {
  private server: http.Server;
  private handlers = new Map<string, (params: unknown[]) => unknown>();
  public calls: Array<{ method: string; params: unknown[] }> = [];

  constructor() {
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const rpc = JSON.parse(body) as RpcRequest;
          this.calls.push({ method: rpc.method, params: rpc.params });

          const handler = this.handlers.get(rpc.method);
          if (!handler) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32601, message: `Method ${rpc.method} not found` },
                id: rpc.id,
              })
            );
            return;
          }

          const result = handler(rpc.params);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", result, id: rpc.id }));
        } catch {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });
    });
  }

  /** Register a handler for a specific RPC method */
  on(method: string, handler: (params: unknown[]) => unknown): this {
    this.handlers.set(method, handler);
    return this;
  }

  /** Start the server and return its URL */
  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const { port } = this.server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}/api/`);
      });
    });
  }

  /** Stop the server, forcibly closing any lingering keep-alive connections */
  async stop(): Promise<void> {
    // closeAllConnections() is Node 18.2+ – destroys keep-alive sockets so
    // close() doesn't hang waiting for idle connections to drain.
    this.server.closeAllConnections?.();
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Reset recorded calls */
  reset(): void {
    this.calls = [];
  }
}

/**
 * Creates a MockSymconServer pre-loaded with sensible default handlers
 * covering the most common Symcon API calls.
 */
export function createDefaultMock(): MockSymconServer {
  const mock = new MockSymconServer();

  // Kernel
  mock.on("IPS_GetKernelVersion", () => "7.0.0 (Build 12345)");

  // Variables
  mock.on("GetValue", ([id]) => {
    const values: Record<number, unknown> = {
      10001: true,
      10002: 21.5,
      10003: "Hello",
      10004: 42,
    };
    return values[id as number] ?? false;
  });

  mock.on("SetValue", () => true);
  mock.on("RequestAction", () => true);

  mock.on("IPS_GetVariable", ([id]) => ({
    VariableID: id,
    VariableType: 0,
    VariableUpdated: Math.floor(Date.now() / 1000),
    VariableChanged: Math.floor(Date.now() / 1000) - 60,
    VariableAction: 0,
    VariableCustomAction: 0,
    VariableProfile: "~Switch",
    VariableCustomProfile: "",
    VariableValue: true,
  }));

  // Objects
  mock.on("IPS_GetObject", ([id]) => ({
    ObjectID: id,
    ObjectType: id === 0 ? 0 : 2,
    ObjectName: id === 0 ? "Root" : `Object_${id}`,
    ObjectInfo: "",
    ObjectIcon: "IPS",
    ObjectSummary: "",
    ParentID: id === 0 ? -1 : 0,
    ChildrenIDs: id === 0 ? [10001, 10002] : [],
    HasChildren: id === 0,
    IsHidden: false,
    IsDisabled: false,
    IsReadOnly: false,
    Position: 0,
  }));

  mock.on("IPS_GetChildrenIDs", ([id]) => {
    if (id === 0) return [10001, 10002, 10003, 20001];
    if (id === 20001) return [10004];
    return [];
  });

  mock.on("IPS_GetObjectIDByName", ([name, _parentId]) => {
    const nameMap: Record<string, number> = {
      "Living Room": 20001,
      Light: 10001,
      Temperature: 10002,
    };
    return nameMap[name as string] ?? -1;
  });

  mock.on("IPS_GetObjectList", () => ({
    0: { ObjectID: 0, ObjectType: 0, ObjectName: "Root", ParentID: -1 },
    10001: { ObjectID: 10001, ObjectType: 2, ObjectName: "Light", ParentID: 20001 },
    10002: { ObjectID: 10002, ObjectType: 2, ObjectName: "Temperature", ParentID: 20001 },
    20001: { ObjectID: 20001, ObjectType: 1, ObjectName: "Living Room", ParentID: 0 },
  }));

  // Scripts
  mock.on("IPS_RunScript", () => "");
  mock.on("IPS_RunScriptText", () => "script_result");
  mock.on("IPS_CreateScript", () => 99001);
  mock.on("IPS_SetName", () => true);
  mock.on("IPS_SetParent", () => true);
  mock.on("IPS_SetScriptContent", () => true);
  mock.on("IPS_DeleteScript", () => true);

  return mock;
}
