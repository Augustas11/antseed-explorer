import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = "Route Claude Code through the AntSeed P2P network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const imageOptions = {
  ...size,
  headers: {
    "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
  },
};

export default function BlogOG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0b10",
          color: "#e7e9ee",
          padding: 80,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 26, color: "#7cf2c8", fontWeight: 600 }}>
            AntFeed
          </div>
          <div style={{ fontSize: 26, color: "#8a8f9c" }}>Blog</div>
          <div style={{ flexGrow: 1 }} />
          <div
            style={{
              fontSize: 16,
              color: "#8a8f9c",
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            Guide
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            fontSize: 60,
            fontWeight: 700,
            marginTop: 52,
            lineHeight: 1.1,
            letterSpacing: -1,
            maxWidth: 960,
          }}
        >
          <span>Route Claude Code through the&nbsp;</span>
          <span style={{ color: "#7cf2c8" }}>AntSeed P2P network</span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 26,
            color: "#8a8f9c",
            marginTop: 24,
            lineHeight: 1.4,
            maxWidth: 880,
          }}
        >
          No API key. USDC settlement on Base. Two env vars. Five minutes.
        </div>

        {/* Code snippet */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 40,
            padding: "16px 24px",
            background: "#11131c",
            border: "1px solid #1f2230",
            borderRadius: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 24,
            color: "#7cf2c8",
            alignSelf: "flex-start",
          }}
        >
          export ANTHROPIC_BASE_URL=http://localhost:8377
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "auto",
            fontSize: 20,
            color: "#8a8f9c",
            borderTop: "1px solid #1f2230",
            paddingTop: 24,
          }}
        >
          <div>antfeed.org/blog/claude-code-on-antseed</div>
          <div>Independent — not affiliated with the AntSeed team</div>
        </div>
      </div>
    ),
    imageOptions,
  );
}
