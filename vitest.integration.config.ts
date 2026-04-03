import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 90_000,
    reporters: ["verbose"],
  },
});
