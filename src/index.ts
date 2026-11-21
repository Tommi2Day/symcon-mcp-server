import crypto from "crypto";
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
const HOST = process.env.MCP_HOST || "127.0.0.1";
const ALLOW_NO_AUTH = process.env.MCP_ALLOW_NO_AUTH === "true";
const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const RATE_LIMIT_PER_MIN = parseInt(process.env.MCP_RATE_LIMIT || "300", 10);
const MAX_SESSIONS = 100;
const SESSION_IDLE_MS = 30 * 60 * 1000;

// Fail closed: the tools can run arbitrary PHP in Symcon, so an unauthenticated
// network-reachable server must be an explicit opt-in.
if (!MCP_AUTH_TOKEN && TRANSPORT !== "stdio" && !ALLOW_NO_AUTH) {
  logger.error(
    "MCP_AUTH_TOKEN is not set. Refusing to start an unauthenticated server. " +
      "Set MCP_AUTH_TOKEN, or set MCP_ALLOW_NO_AUTH=true to explicitly disable authentication."
  );
  process.exit(1);
}

const symcon = new SymconClient({
  url: process.env.SYMCON_API_URL || "http://localhost:3777/api/",
  username: process.env.SYMCON_API_USER || "",
  password: process.env.SYMCON_API_PASSWORD || "",
  tlsVerify: process.env.SYMCON_TLS_VERIFY !== "false",
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// ─── Rate limiting (per client IP, fixed window) ────────────────────────────
const rateBuckets = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.reset <= now) rateBuckets.delete(k);
}, 60_000).unref();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  if (!RATE_LIMIT_PER_MIN) return next();
  const key = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + 60_000 };
    rateBuckets.set(key, b);
  }
  if (++b.count > RATE_LIMIT_PER_MIN) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}
app.use(rateLimit);

// ─── Origin check (DNS-rebinding protection) ────────────────────────────────
// Non-browser MCP clients send no Origin header; browsers always do.
function originMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers["origin"];
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return next();
  res.status(403).json({ error: "Origin not allowed" });
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── Auth Middleware ────────────────────────────────────────────────────────
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!MCP_AUTH_TOKEN) return next();
  const bearer = req.headers["authorization"];
  const xkey = req.headers["x-mcp-api-key"];
  const token =
    bearer?.startsWith("Bearer ") ? bearer.slice(7) : xkey;
  if (typeof token === "string" && safeEqual(token, MCP_AUTH_TOKEN)) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ─── Health Endpoint ─────────────────────────────────────────────────────────
let healthCache: { at: number; ok: boolean; error?: string } | undefined;
app.get("/health", async (_req: Request, res: Response) => {
  const start = Date.now();
  if (!healthCache || start - healthCache.at > 5000) {
    try {
      await symcon.ping();
      healthCache = { at: Date.now(), ok: true };
    } catch (e: unknown) {
      logger.warn(`Health check failed: ${e instanceof Error ? e.message : String(e)}`);
      healthCache = { at: Date.now(), ok: false, error: "unreachable" };
    }
  }
  const symconOk = healthCache.ok;
  const symconError = healthCache.error;

  const status = symconOk ? 200 : 503;
  res.status(status).json({
    status: symconOk ? "ok" : "degraded",
    version: VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
    symcon: {
      status: symconOk ? "ok" : "error",
      ...(symconError ? { error: `Symcon JSON API not working (${symconError})` } : {}),
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
  const lastSeen = new Map<string, number>();
  setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, t] of transports) {
      if ((lastSeen.get(id) ?? 0) < cutoff) {
        transports.delete(id);
        lastSeen.delete(id);
        void t.close().catch(() => undefined);
        logger.info(`Session expired: ${id}`);
      }
    }
  }, 60_000).unref();

  app.all("/mcp", originMiddleware, authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId) lastSeen.set(sessionId, Date.now());

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
      const t = sessionId ? transports.get(sessionId) : undefined;
      if (sessionId && t) {
        transports.delete(sessionId);
        lastSeen.delete(sessionId);
        await t.close().catch(() => undefined);
        logger.info(`Session deleted: ${sessionId}`);
      }
      res.status(204).end();
      return;
    }

    // POST – new or existing session
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (transports.size >= MAX_SESSIONS) {
        res.status(503).json({ error: "Too many sessions" });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
          lastSeen.set(id, Date.now());
          logger.info(`New session: ${id}`);
        },
      });
      transport.onclose = () => {
        const id = transport!.sessionId;
        if (id) {
          transports.delete(id);
          lastSeen.delete(id);
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

  app.get("/sse", originMiddleware, authMiddleware, async (req: Request, res: Response) => {
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
    originMiddleware,
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
app.get("/info", authMiddleware, async (_req: Request, res: Response) => {
  // Allowlist only – never dump process.env (it may contain unrelated secrets).
  const config: Record<string, string | undefined> = {
    MCP_PORT: process.env.MCP_PORT,
    MCP_TRANSPORT: TRANSPORT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SYMCON_API_URL: process.env.SYMCON_API_URL,
    SYMCON_API_USER: process.env.SYMCON_API_USER,
    SYMCON_TLS_VERIFY: process.env.SYMCON_TLS_VERIFY,
    SYMCON_API_PASSWORD: process.env.SYMCON_API_PASSWORD ? "********" : undefined,
    MCP_AUTH_TOKEN: MCP_AUTH_TOKEN ? "********" : undefined,
  };

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
app.listen(PORT, HOST, async () => {
  logger.info(`Symcon MCP Server listening at http://${HOST}:${PORT}`);
  logger.info(`Symcon API: ${process.env.SYMCON_API_URL}`);
  logger.info(`Auth: ${MCP_AUTH_TOKEN ? "enabled" : "DISABLED (MCP_ALLOW_NO_AUTH=true)"}`);
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
