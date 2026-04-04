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
import { SymconClient } from "../src/symcon.js";

const SKIP =
  process.env.SKIP_INTEGRATION === "true" ||
  (!process.env.SYMCON_TEST_URL && !process.env.CI && !process.env.DOCKER_AVAILABLE);

// Set DOCKER_AVAILABLE if you have docker installed locally to run these tests automatically
// or just run with CI=true npm run test:integration

// In CI the service container URL is injected via env; locally we start our own
// const TEST_URL = process.env.SYMCON_TEST_URL || "http://127.0.0.1:3777/api/";

let client: SymconClient;
let containerInfo: { apiUrl: string } | null = null;

beforeAll(async () => {
  if (SKIP) return;

  // If SYMCON_TEST_URL is provided (CI), use it directly
  if (process.env.SYMCON_TEST_URL) {
    client = new SymconClient({ url: process.env.SYMCON_TEST_URL });
    return;
  }

  // Otherwise start Docker container locally
  const { startSymconContainer } = await import("./helpers/symcon-docker.js");
  try {
    containerInfo = await startSymconContainer();
    client = new SymconClient({ url: containerInfo.apiUrl });
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
