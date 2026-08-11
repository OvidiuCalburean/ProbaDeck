import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  build: {
    format: "directory",
    inlineStylesheets: "always",
  },
  integrations: [react()],
  outDir: "./dist/client",
  output: "static",
  server: {
    host: true,
  },
  site: "https://probadeck.com",
  trailingSlash: "always",
  vite: {
    server: {
      allowedHosts: ["terminal.local"],
    },
  },
});
