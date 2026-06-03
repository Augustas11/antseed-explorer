import assert from "node:assert/strict";

const configuredUrl = process.env.CSP_RUNTIME_URL;
assert.ok(
  configuredUrl,
  "CSP_RUNTIME_URL is required; point it at a local preview or an explicitly chosen deployment",
);
const url = configuredUrl;

function getDirective(policy: string, name: string): string {
  const directive = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

  assert.ok(directive, `CSP must include ${name}`);
  return directive;
}

function getNonce(policy: string): string {
  const scriptSrc = getDirective(policy, "script-src");
  assert.equal(
    scriptSrc.includes("unsafe-inline"),
    false,
    "script-src must not allow unsafe-inline",
  );

  const match = scriptSrc.match(/'nonce-([^']+)'/);
  assert.ok(match, "script-src must include a nonce");
  return match[1];
}

function assertStylePolicy(policy: string) {
  assert.equal(
    getDirective(policy, "style-src"),
    "style-src 'self'",
    "style-src must not broadly allow unsafe-inline",
  );
  assert.equal(
    getDirective(policy, "style-src-elem"),
    "style-src-elem 'self'",
    "style-src-elem must stay restricted to self",
  );
  assert.equal(
    getDirective(policy, "style-src-attr"),
    "style-src-attr 'unsafe-inline'",
    "style-src-attr may allow existing dynamic inline style attributes",
  );
}

function tags(html: string, name: string): string[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(re)].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}=(["'])(.*?)\\1`, "i");
  return tag.match(re)?.[2] ?? null;
}

async function main() {
  const res = await fetch(url, { redirect: "follow" });
  assert.equal(res.ok, true, `expected ${url} to return 2xx, got ${res.status}`);

  const finalUrl = res.url || url;
  const policy = res.headers.get("content-security-policy");
  assert.ok(policy, `${finalUrl} must return a Content-Security-Policy header`);

  const nonce = getNonce(policy);
  assertStylePolicy(policy);
  const html = await res.text();
  const scriptTags = tags(html, "script");
  assert.ok(scriptTags.length > 0, `${finalUrl} must render script tags`);

  const missingNonce = scriptTags.filter((tag) => attr(tag, "nonce") !== nonce);
  assert.deepEqual(
    missingNonce,
    [],
    "every rendered script tag must carry the CSP nonce",
  );

  const stylesheetLinks = tags(html, "link").filter((tag) => {
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    const as = attr(tag, "as")?.toLowerCase() ?? "";
    return rel === "stylesheet" || (rel === "preload" && as === "style");
  });

  const missingStyleNonce = stylesheetLinks.filter((tag) => attr(tag, "nonce") !== nonce);
  assert.deepEqual(
    missingStyleNonce,
    [],
    "rendered stylesheet links must carry the CSP nonce",
  );

  assert.match(html, /<main\b/, "rendered HTML should include the application shell");

  console.log(`Runtime CSP checks passed for ${finalUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
