/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

module.exports = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Legacy /favicon.ico clients (older RSS readers, some chat unfurlers)
      // still hit this path directly instead of reading <link rel="icon">.
      { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
      // Collapse the apex onto www so X/Twitter keeps ONE unfurl cache entry.
      // Without this, links shared as antfeed.org vs www.antfeed.org cache
      // independently and can show different-age OG cards. Canonical/og:url and
      // metadataBase both use www, so the apex must redirect there.
      {
        source: "/:path*",
        has: [{ type: "host", value: "antfeed.org" }],
        destination: "https://www.antfeed.org/:path*",
        permanent: true,
      },
    ];
  },
};
