/**
 * tests/helpers/symcon-docker.ts
 *
 * Starts a real IP-Symcon Docker container for integration tests.
 * Uses the official symcon/symcon-server image.
 *
 * The container exposes Symcon's JSON-RPC API on port 3777.
 * We wait for it to become ready before running tests.
 */

import { execSync } from "child_process";

const SYMCON_IMAGE = "symcon/symcon:latest";
const CONTAINER_NAME = "symcon-mcp-test";
const SYMCON_PORT = 3777;
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const SYMCON_API_USER = "test@symcon.de";
const SYMCON_API_PASSWORD = "symcon";

let containerStarted = false;

export interface SymconTestConfig {
  apiUrl: string;
  port: number;
}

/**
 * Pull and start the Symcon Docker container.
 * Returns the connection config once ready.
 */
export async function startSymconContainer(): Promise<SymconTestConfig> {
  // Check if Docker is available
  try {
    execSync("docker info", { stdio: "pipe" });
  } catch {
    throw new Error("Docker is not available. Integration tests require Docker.");
  }

  // Remove any existing container
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: "pipe" });
  } catch {
    /* ignore if not exists */
  }

  // Pull image (cached on subsequent runs)
  console.log(`[test] Pulling ${SYMCON_IMAGE}...`);
  try {
    execSync(`docker pull ${SYMCON_IMAGE}`, { stdio: "pipe" });
  } catch {
    console.warn(`[test] Could not pull ${SYMCON_IMAGE}, trying with existing image`);
  }

  // Start container
  console.log(`[test] Starting Symcon container on port ${SYMCON_PORT}...`);
  const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
  execSync(
    `docker run -d --name ${CONTAINER_NAME} \
      -p ${SYMCON_PORT}:3777 \
      -e SYMCON_API_USER=${SYMCON_API_USER} \
      -e SYMCON_API_PASSWORD=${SYMCON_API_PASSWORD} \
      --entrypoint /bin/sh \
      ${SYMCON_IMAGE} \
      -c 'if [ ! -f /root/.symcon ]; then \
          SYMCON_API_PASSWORD_BASE64=$(echo -n "${SYMCON_API_PASSWORD}" | base64); \
          echo "Licensee=${SYMCON_API_USER}" > /root/.symcon; \
          echo "Password=$SYMCON_API_PASSWORD_BASE64" >> /root/.symcon; \
          chmod 600 /root/.symcon; \
          fi; exec /usr/bin/symcon'`,
    { stdio: "pipe", env }
  );
  containerStarted = true;

  // Wait for Symcon to be ready
  const apiUrl = `http://127.0.0.1:${SYMCON_PORT}/api/`;
  await waitForSymcon(apiUrl);
  console.log("[test] Symcon container is ready.");

  return { apiUrl, port: SYMCON_PORT };
}

/**
 * Stop and remove the test container.
 */
export function stopSymconContainer(): void {
  if (!containerStarted) return;
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: "pipe" });
    console.log("[test] Symcon container stopped.");
  } catch {
    /* ignore */
  }
}

/**
 * Poll the Symcon JSON-RPC API until it responds or timeout expires.
 */
async function waitForSymcon(apiUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const body = JSON.stringify({ jsonrpc: "2.0", method: "IPS_GetKernelVersion", params: [], id: 1 });

  while (Date.now() < deadline) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: string };
        if (json.result) return;
      }
    } catch {
      /* not ready yet */
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Symcon did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a raw JSON-RPC call against the test Symcon instance.
 */
export async function symconRpc<T = unknown>(
  apiUrl: string,
  method: string,
  params: unknown[] = []
): Promise<T> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}
