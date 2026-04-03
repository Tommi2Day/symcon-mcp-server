#!/usr/bin/env node
/**
 * scripts/bump-version.mjs
 *
 * Called automatically by `npm version <semver>` via the "version" lifecycle hook.
 * Currently a placeholder – extend here if you add openapi.json or helm charts.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));

// eslint-disable-next-line no-undef
console.log(`[bump-version] Version is now: ${pkg.version}`);
// Add further file synchronization here, e.g. openapi.json, helm Chart.yaml
