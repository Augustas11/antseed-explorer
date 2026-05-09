import { ImageResponse } from "next/og";
import { getNetworkStats } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "AntSeed Demand Explorer — on-chain buyer intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function HomeOG() {
  let stats: Awaited<ReturnType<typeof getNetworkStats>> | null = null;
  try {
    stats = await getNetworkStats();
  } catch {
    // Render a static fallback if DB is unreachable; never block sharing.
  }

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

        <div style={{ display: "flex", gap: 60, marginTop: "auto" }}>
          <Stat label="Buyers indexed" value={fmtNum(stats?.totalBuyers)} />
          <Stat label="USDC settled" value={fmtUsd(stats?.totalVolumeUsdc)} />
          <Stat label="Sessions" value={fmtNum(stats?.totalSessions)} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 18, color: "#8a8f9c", textTransform: "uppercase", letterSpacing: 1.2 }}>
        {label}
      </div>
      <div style={{ fontSize: 56, fontWeight: 700, color: "#e7e9ee", marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "$0";
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(0)}`;
}
