import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "AntFeed MCP — discover and transact on AntSeed from any AI agent";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function McpOG() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 32, color: "#7cf2c8", fontWeight: 600 }}>
            AntFeed
          </div>
          <div style={{ fontSize: 32, color: "#8a8f9c" }}>MCP</div>
        </div>

        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            marginTop: 60,
            lineHeight: 1.1,
            letterSpacing: -1.5,
          }}
        >
          The AntSeed network,
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: "#7cf2c8",
          }}
        >
          one line into your agent.
        </div>

        <div
          style={{
            fontSize: 28,
            color: "#8a8f9c",
            marginTop: 28,
            maxWidth: 1040,
            lineHeight: 1.35,
          }}
        >
          Model Context Protocol server for Claude Code, Cursor, Claude Desktop.
          List providers, look up addresses, inspect sessions, open channels.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: "auto",
            fontSize: 28,
            color: "#e7e9ee",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "10px 18px",
              background: "#11131c",
              border: "1px solid #1f2230",
              borderRadius: 10,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 26,
              color: "#7cf2c8",
            }}
          >
            npx @antfeed/mcp
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 32,
            fontSize: 20,
            color: "#8a8f9c",
            borderTop: "1px solid #1f2230",
            paddingTop: 24,
          }}
        >
          <div>antfeed.org/mcp</div>
          <div>Independent — not affiliated with the AntSeed team</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
