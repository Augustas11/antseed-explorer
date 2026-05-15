import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 5000,
    // No CSS imports in this Node-only MCP. Disable CSS handling so vitest
    // does not walk up the tree to discover the explorer's root
    // postcss.config.js (which requires tailwindcss — a dep of the parent
    // package, not this one). Reproduced as a CI failure on 2026-05-15.
    css: false,
  },
});
