import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    forceExit: true,
    reporters: ["verbose"],
  },
});
