#!/usr/bin/env node
/**
 * scripts/bump-version.mjs
 *
 * Called automatically by `npm version <semver>` via the "version" lifecycle hook.
 * Syncs the version string in openapi.yaml to match package.json.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "../package.json");
const openapiPath = resolve(__dirname, "../openapi.yaml");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;

// eslint-disable-next-line no-undef
console.log(`[bump-version] Version is now: ${version}`);

// Sync openapi.yaml — replace the `  version: x.y.z` line under info:
try {
  const yaml = readFileSync(openapiPath, "utf8");
  const updated = yaml.replace(
    /^(\s+version:\s+)[\d.]+\s*$/m,
    `$1${version}`
  );
  writeFileSync(openapiPath, updated);
  // eslint-disable-next-line no-undef
  console.log(`[bump-version] Updated openapi.yaml to ${version}`);
} catch (e) {
  // eslint-disable-next-line no-undef
  console.warn(`[bump-version] Failed to update openapi.yaml: ${e.message}`);
}
