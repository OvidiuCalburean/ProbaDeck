import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["browser/**/*.test.ts"],
    coverage: {
      exclude: ["src/**/*.d.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        100: true,
        perFile: true,
      },
    },
  },
});
