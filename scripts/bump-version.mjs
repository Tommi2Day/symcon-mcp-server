#!/usr/bin/env node
/**
 * scripts/bump-version.mjs
 *
 * Called automatically by `npm version <semver>` via the "version" lifecycle hook.
 * Currently a placeholder – extend here if you add openapi.json or helm charts.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "../package.json");
const openapiPath = resolve(__dirname, "../openapi.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;

// eslint-disable-next-line no-undef
console.log(`[bump-version] Version is now: ${version}`);

// Sync openapi.json
try {
  const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));
  openapi.info.version = version;
  writeFileSync(openapiPath, JSON.stringify(openapi, null, 2) + "\n");
  // eslint-disable-next-line no-undef
  console.log(`[bump-version] Updated openapi.json to ${version}`);
} catch (e) {
  // eslint-disable-next-line no-undef
  console.warn(`[bump-version] Failed to update openapi.json: ${e.message}`);
}
