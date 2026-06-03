import assert from "node:assert/strict";
import fs from "node:fs";

const nextConfig = fs.readFileSync("next.config.js", "utf8");
const middleware = fs.readFileSync("middleware.ts", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");

assert.equal(
  /script-src[^;\n]*unsafe-inline/.test(nextConfig + middleware),
  false,
  "script-src must not allow unsafe-inline",
);
assert.match(middleware, /script-src 'self' 'nonce-\$\{nonce\}'/);
assert.match(middleware, /requestHeaders\.set\("content-security-policy", policy\)/);
assert.match(middleware, /Content-Security-Policy/);
assert.match(layout, /nonce=\{nonce\}/);
assert.match(layout, /headers\(\)/);

console.log("Security header checks passed");
