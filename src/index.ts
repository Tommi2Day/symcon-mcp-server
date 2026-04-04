import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SymconClient } from "./symcon.js";
import { registerTools } from "./tools.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const VERSION = pkg.version || "0.0.0";

const PORT = parseInt(process.env.MCP_PORT || "4096", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";
const TRANSPORT = process.env.MCP_TRANSPORT || "streamable"; // "streamable" | "sse" | "stdio"

const symcon = new SymconClient({
  url: process.env.SYMCON_API_URL || "http://localhost:3777/api/",
  username: process.env.SYMCON_API_USER || "",
  password: process.env.SYMCON_API_PASSWORD || "",
  tlsVerify: process.env.SYMCON_TLS_VERIFY !== "false",
});

const app = express();
app.use(express.json());

// ─── Auth Middleware ────────────────────────────────────────────────────────
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!MCP_AUTH_TOKEN) return next();
  const bearer = req.headers["authorization"];
  const xkey = req.headers["x-mcp-api-key"];
  const token =
    bearer?.startsWith("Bearer ") ? bearer.slice(7) : (xkey as string);
  if (token === MCP_AUTH_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ─── Health Endpoint ─────────────────────────────────────────────────────────
app.get("/health", async (_req: Request, res: Response) => {
  const start = Date.now();
  let symconOk = false;
  let symconError: string | undefined;

  try {
    await symcon.ping();
    symconOk = true;
  } catch (e: unknown) {
    symconError = e instanceof Error ? e.message : String(e);
  }

  const status = symconOk ? 200 : 503;
  res.status(status).json({
    status: symconOk ? "ok" : "degraded",
    version: VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
    symcon: {
      url: process.env.SYMCON_API_URL,
      status: symconOk ? "ok" : "error",
      ...(symconError ? { error: `Symcon JSON API not working: ${symconError}` } : {}),
    },
  });
});

// ─── MCP Server Factory ───────────────────────────────────────────────────
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "symcon-mcp-server",
    version: VERSION,
  });
  registerTools(server, symcon);
  return server;
}

// ─── Streamable HTTP Transport (modern, stateless) ───────────────────────
if (TRANSPORT === "streamable") {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.all("/mcp", authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "GET") {
      // Resumption / ping
      const t = sessionId ? transports.get(sessionId) : undefined;
      if (!t) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await t.handleRequest(req, res);
      return;
    }

    if (req.method === "DELETE") {
      if (sessionId) {
        transports.delete(sessionId);
        logger.info(`Session deleted: ${sessionId}`);
      }
      res.status(204).end();
      return;
    }

    // POST – new or existing session
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () =>
          Math.random().toString(36).slice(2) + Date.now().toString(36),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
          logger.info(`New session: ${id}`);
        },
      });
      transport.onclose = () => {
        const id = transport!.sessionId;
        if (id) {
          transports.delete(id);
          logger.info(`Session closed: ${id}`);
        }
      };
      const server = createMcpServer();
      await server.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  logger.info(`Using Streamable HTTP transport at /mcp`);
}

// ─── SSE Transport (legacy, für ältere Clients) ──────────────────────────
if (TRANSPORT === "sse") {
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", authMiddleware, async (req: Request, res: Response) => {
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);
    logger.info(`SSE connection: ${transport.sessionId}`);

    transport.onclose = () => {
      sseTransports.delete(transport.sessionId);
      logger.info(`SSE disconnected: ${transport.sessionId}`);
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.start();
  });

  app.post(
    "/messages",
    authMiddleware,
    async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = sseTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await transport.handlePostMessage(req, res, req.body);
    }
  );

  logger.info(`Using SSE transport at /sse + /messages`);
}

// ─── Stdio Transport (standard CLI usage) ───────────────────────────────────
if (TRANSPORT === "stdio") {
  const transport = new StdioServerTransport();
  const server = createMcpServer();
  await server.connect(transport);
  logger.info(`Using Stdio transport`);
}

// ─── Root info ───────────────────────────────────────────────────────────────
app.get("/info", async (_req: Request, res: Response) => {
  const config = { ...process.env };
  const sensitiveKeys = ["SYMCON_API_PASSWORD", "MCP_AUTH_TOKEN"];

  for (const key of sensitiveKeys) {
    if (config[key]) {
      config[key] = "********";
    }
  }

  let symconVersion: string | undefined;
  let symconError: string | undefined;

  try {
    symconVersion = await symcon.ping();
  } catch (e: unknown) {
    symconError = e instanceof Error ? e.message : String(e);
  }

  res.json({
    version: VERSION,
    config: config,
    symcon: {
      version: symconVersion,
      ...(symconError ? { error: symconError } : {}),
    },
  });
});

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Symcon MCP Server",
    transport: TRANSPORT,
    endpoints: {
      health: "/health",
      info: "/info",
      mcp: TRANSPORT === "sse" ? "/sse" : "/mcp",
    },
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  logger.info(`Symcon MCP Server listening at http://localhost:${PORT}`);
  logger.info(`Symcon API: ${process.env.SYMCON_API_URL}`);
  logger.info(`Auth: ${MCP_AUTH_TOKEN ? "enabled" : "disabled"}`);
  logger.info(`Transport: ${TRANSPORT}`);

  // Test Symcon RPC connection
  try {
    const version = await symcon.ping();
    logger.info(`Symcon API access successful (Version: ${version})`);
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.error(`Symcon API access failed: ${errorMsg}`);
  }
});
