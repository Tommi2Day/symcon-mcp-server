import https from "https";
import { logger } from "./logger.js";

export interface SymconClientOptions {
  url: string;
  username?: string;
  password?: string;
  tlsVerify?: boolean;
}

export interface RpcResponse<T = unknown> {
  result?: T;
  error?: { code: number; message: string };
  id: number;
}

let requestId = 1;

export class SymconClient {
  private readonly url: string;
  private readonly authHeader: string | undefined;
  private readonly agent: https.Agent | undefined;

  constructor(opts: SymconClientOptions) {
    this.url = opts.url.endsWith("/") ? opts.url : opts.url + "/";

    if (opts.username && opts.password) {
      const encoded = Buffer.from(
        `${opts.username}:${opts.password}`
      ).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    }

    if (this.url.startsWith("https") && opts.tlsVerify === false) {
      this.agent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /** Low-level JSON-RPC call */
  async rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const id = requestId++;
    const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.authHeader) headers["Authorization"] = this.authHeader;

    const fetchOptions: RequestInit = {
      method: "POST",
      headers,
      body,
    };

    // Node 18+ has native fetch; attach agent for https if needed
    if (this.agent) {
      // @ts-expect-error – undici/node fetch accepts agent via dispatcher
      fetchOptions.dispatcher = undefined; // handled below for older Node
    }

    let response: globalThis.Response;
    try {
      if (this.agent) {
        // Fallback using node-fetch style – actually use https module directly
        const data = await this.httpsPost(body, headers);
        const json = JSON.parse(data) as RpcResponse<T>;
        if (json.error) throw new Error(`Symcon RPC error: ${json.error.message} (code ${json.error.code})`);
        return json.result as T;
      }
      response = await fetch(this.url, fetchOptions);
    } catch (e) {
      logger.warn(`Symcon RPC failed [${method}]: ${e}`);
      throw e;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Symcon`);
    }
    const json = (await response.json()) as RpcResponse<T>;
    if (json.error) {
      throw new Error(`Symcon RPC error: ${json.error.message} (code ${json.error.code})`);
    }
    return json.result as T;
  }

  /** Use Node's https module directly when TLS verification is disabled */
  private httpsPost(body: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.url);
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: "POST",
          headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
          agent: this.agent,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  /** Simple connectivity check – calls IPS_GetKernelVersion */
  async ping(): Promise<string> {
    return this.rpc<string>("IPS_GetKernelVersion");
  }

  // ─── Variable API ──────────────────────────────────────────────────────────

  async getValue(variableId: number): Promise<unknown> {
    return this.rpc("GetValue", [variableId]);
  }

  async setValue(variableId: number, value: unknown): Promise<boolean> {
    return this.rpc("SetValue", [variableId, value]);
  }

  async requestAction(variableId: number, value: unknown): Promise<boolean> {
    return this.rpc("RequestAction", [variableId, value]);
  }

  async getVariable(variableId: number): Promise<SymconVariable> {
    return this.rpc<SymconVariable>("IPS_GetVariable", [variableId]);
  }

  // ─── Object API ───────────────────────────────────────────────────────────

  async getObject(objectId: number): Promise<SymconObject> {
    return this.rpc<SymconObject>("IPS_GetObject", [objectId]);
  }

  async getChildrenIds(objectId: number): Promise<number[]> {
    return this.rpc<number[]>("IPS_GetChildrenIDs", [objectId]);
  }

  async getObjectIdByName(name: string, parentId = 0): Promise<number> {
    return this.rpc<number>("IPS_GetObjectIDByName", [name, parentId]);
  }

  async getAllObjects(): Promise<Record<number, SymconObject>> {
    return this.rpc<Record<number, SymconObject>>("IPS_GetObjectList");
  }

  // ─── Script API ───────────────────────────────────────────────────────────

  async runScript(scriptId: number): Promise<string> {
    return this.rpc<string>("IPS_RunScript", [scriptId]);
  }

  async runScriptText(script: string): Promise<string> {
    return this.rpc<string>("IPS_RunScriptText", [script]);
  }

  async createScript(parentId: number, name: string): Promise<number> {
    return this.rpc<number>("IPS_CreateScript", [0, name, parentId]);
  }

  async setScriptContent(scriptId: number, content: string): Promise<boolean> {
    return this.rpc<boolean>("IPS_SetScriptContent", [scriptId, content]);
  }

  async deleteScript(scriptId: number): Promise<boolean> {
    return this.rpc<boolean>("IPS_DeleteScript", [scriptId]);
  }

  // ─── Snapshot helper ──────────────────────────────────────────────────────

  async snapshotVariables(
    rootId = 0,
    maxDepth = 5
  ): Promise<Record<number, unknown>> {
    const snapshot: Record<number, unknown> = {};
    await this.collectVariables(rootId, snapshot, maxDepth, 0);
    return snapshot;
  }

  private async collectVariables(
    objectId: number,
    out: Record<number, unknown>,
    maxDepth: number,
    depth: number
  ): Promise<void> {
    if (depth > maxDepth) return;
    const obj = await this.getObject(objectId);
    if (obj.ObjectType === 2 /* variable */) {
      try {
        out[objectId] = await this.getValue(objectId);
      } catch {
        /* skip unreadable */
      }
    }
    const children = await this.getChildrenIds(objectId);
    await Promise.all(
      children.map((id) =>
        this.collectVariables(id, out, maxDepth, depth + 1)
      )
    );
  }
}

// ─── Symcon Object Types ──────────────────────────────────────────────────────

export interface SymconObject {
  ObjectID: number;
  ObjectType: number; // 0=category,1=instance,2=variable,3=script,4=event,5=media,6=link
  ObjectName: string;
  ObjectInfo: string;
  ObjectIcon: string;
  ObjectSummary: string;
  ParentID: number;
  ChildrenIDs: number[];
  HasChildren: boolean;
  IsHidden: boolean;
  IsDisabled: boolean;
  IsReadOnly: boolean;
  Position: number;
}

export interface SymconVariable {
  VariableID: number;
  VariableType: number; // 0=bool,1=int,2=float,3=string
  VariableUpdated: number;
  VariableChanged: number;
  VariableAction: number;
  VariableCustomAction: number;
  VariableProfile: string;
  VariableCustomProfile: string;
  VariableValue: unknown;
}
