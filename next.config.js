/** @type {import('next').NextConfig} */

// CSP keeps 'unsafe-inline' on script-src — Next 14 App Router emits inline
// hydration scripts (the __next_f bootstrap) and a strict CSP would need
// nonce-based middleware. Acceptable trade-off: app has no user-generated
// HTML rendered, so XSS surface is small. Revisit if that changes.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy", value: csp },
];

module.exports = {
  poweredByHeader: false,
  experimental: { serverComponentsExternalPackages: ["better-sqlite3"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    // Legacy /favicon.ico clients (older RSS readers, some chat unfurlers)
    // still hit this path directly instead of reading <link rel="icon">.
    return [
      { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
    ];
  },
};
