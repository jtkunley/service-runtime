import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
