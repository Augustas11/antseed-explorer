import { ImageResponse } from "next/og";
import { getBuyer } from "@/lib/queries";
import { calculateTrustScore } from "@/lib/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Buyer profile — AntSeed Demand Explorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function BuyerOG({
  params,
}: {
  params: { address: string };
}) {
  const buyer = await getBuyer(params.address).catch(() => null);

  if (!buyer) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            background: "#0a0b10",
            color: "#8a8f9c",
            fontSize: 36,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ color: "#7cf2c8", fontSize: 32 }}>AntSeed Demand Explorer</div>
          <div style={{ marginTop: 24 }}>Buyer not indexed</div>
          <div style={{ marginTop: 12, fontSize: 22, fontFamily: "monospace" }}>
            {shortAddr(params.address)}
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const score = calculateTrustScore({
    address: buyer.address,
    totalSessions: buyer.total_sessions,
    totalSettledUsdc: buyer.total_settled_usdc,
    uniqueSellers: buyer.unique_sellers,
    ghostSessions: buyer.ghost_sessions,
  });
  const scoreColor =
    score.total >= 70 ? "#7cf2c8" : score.total >= 40 ? "#f5b656" : "#f57272";
  const scoreBg =
    score.total >= 70
      ? "rgba(124, 242, 200, 0.12)"
      : score.total >= 40
      ? "rgba(245, 182, 86, 0.12)"
      : "rgba(245, 114, 114, 0.12)";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#0a0b10",
          color: "#e7e9ee",
          fontSize: 36,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ color: "#7cf2c8", fontSize: 32 }}>AntSeed Demand Explorer</div>
        <div style={{ marginTop: 24 }}>Trust {score.total}</div>
        <div style={{ marginTop: 12, fontSize: 22 }}>
          {shortAddr(buyer.address)}
        </div>
      </div>
    ),
    { ...size },
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 16, color: "#8a8f9c", textTransform: "uppercase", letterSpacing: 1.2 }}>
        {label}
      </div>
      <div style={{ fontSize: 44, fontWeight: 700, color: "#e7e9ee", marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function shortAddr(a: string, head = 6, tail = 4): string {
  if (a.length <= head + tail) return a;
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "$0";
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return "$0";
}
