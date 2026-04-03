import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SymconClient } from "./symcon.js";
import { registerTools } from "./tools.js";
import { logger } from "./logger.js";

const PORT = parseInt(process.env.MCP_PORT || "4096", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";
const TRANSPORT = process.env.MCP_TRANSPORT || "streamable"; // "streamable" | "sse"

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
    version: process.env.npm_package_version || "1.0.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
    symcon: {
      url: process.env.SYMCON_API_URL,
      reachable: symconOk,
      ...(symconError ? { error: symconError } : {}),
    },
  });
});

// ─── MCP Server Factory ───────────────────────────────────────────────────
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "symcon-mcp-server",
    version: process.env.npm_package_version || "1.0.0",
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

// ─── Root info ───────────────────────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Symcon MCP Server",
    transport: TRANSPORT,
    endpoints: {
      health: "/health",
      mcp: TRANSPORT === "sse" ? "/sse" : "/mcp",
    },
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Symcon MCP Server listening on port ${PORT}`);
  logger.info(`Symcon API: ${process.env.SYMCON_API_URL}`);
  logger.info(`Auth: ${MCP_AUTH_TOKEN ? "enabled" : "disabled"}`);
  logger.info(`Transport: ${TRANSPORT}`);
});
