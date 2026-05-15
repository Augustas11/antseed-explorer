import { defineConfig } from "vitest/config";

export default defineConfig({
  // Provide an inline PostCSS config to prevent vite (under vitest) from
  // walking up the directory tree and discovering the explorer's root
  // postcss.config.js — which requires tailwindcss, a dep of the parent
  // package, not this one. Reproduced as a CI failure on 2026-05-15.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 5000,
  },
});
