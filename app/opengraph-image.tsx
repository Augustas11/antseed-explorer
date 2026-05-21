import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "AntSeed Demand Explorer — on-chain buyer intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function HomeOG() {
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
            AntSeed
          </div>
          <div style={{ fontSize: 32, color: "#8a8f9c" }}>Demand Explorer</div>
        </div>

        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            marginTop: 60,
            lineHeight: 1.1,
            letterSpacing: -1,
          }}
        >
          On-chain buyer intelligence
        </div>
        <div style={{ fontSize: 28, color: "#8a8f9c", marginTop: 16, maxWidth: 900 }}>
          Indexed buyer activity from the AntSeed P2P AI services network on Base.
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: "auto" }}>
          <Pill label="Base events" />
          <Pill label="USDC settlement" />
          <Pill label="Buyer demand" />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 40,
            fontSize: 20,
            color: "#8a8f9c",
            borderTop: "1px solid #1f2230",
            paddingTop: 24,
          }}
        >
          <div>antfeed.org</div>
          <div>Independent — not affiliated with the AntSeed team</div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Pill({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        borderRadius: 999,
        border: "1px solid #263041",
        background: "#111622",
        color: "#d6d9e0",
        fontSize: 22,
        padding: "14px 22px",
      }}
    >
      {label}
    </div>
  );
}
