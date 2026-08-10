import { existsSync } from "node:fs";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const localExecutable =
  process.platform === "darwin" && existsSync(macChrome) ? macChrome : undefined;

export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  test: {
    include: ["browser/**/*.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          headless: true,
          ...(localExecutable === undefined ? {} : { executablePath: localExecutable }),
        },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
