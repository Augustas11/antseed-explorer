import { ImageResponse } from "next/og";
import { getBuyer } from "@/lib/queries";
import { calculateTrustScore } from "@/lib/score";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "Buyer profile — AntSeed Demand Explorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function BuyerOG({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  try {
    const { address } = await params;
    return await renderBuyerOG(address);
  } catch {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%", height: "100%", display: "flex",
            justifyContent: "center", alignItems: "center",
            background: "#0a0b10", color: "#7cf2c8",
            fontSize: 32, fontFamily: "system-ui, sans-serif",
          }}
        >
          AntSeed Demand Explorer
        </div>
      ),
      { ...size },
    );
  }
}

async function renderBuyerOG(address: string) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%", height: "100%", display: "flex",
            justifyContent: "center", alignItems: "center",
            background: "#0a0b10", color: "#8a8f9c",
            fontSize: 36, fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ color: "#7cf2c8", fontSize: 32 }}>AntSeed Demand Explorer</div>
        </div>
      ),
      { ...size },
    );
  }

  const buyer = await getBuyer(address).catch(() => null);

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
            {shortAddr(address)}
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
          background: "#0a0b10",
          color: "#e7e9ee",
          padding: 70,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 26, color: "#7cf2c8", fontWeight: 600 }}>
            AntSeed
          </div>
          <div style={{ fontSize: 26, color: "#8a8f9c" }}>Demand Explorer</div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ fontSize: 18, color: "#8a8f9c" }}>
            BUYER PROFILE
          </div>
        </div>

        <div style={{ display: "flex", gap: 50, marginTop: 50, alignItems: "flex-start" }}>
          {/* Score */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: 28,
              paddingBottom: 28,
              paddingLeft: 36,
              paddingRight: 36,
              borderRadius: 16,
              background: scoreBg,
              borderWidth: 2,
              borderStyle: "solid",
              borderColor: scoreColor,
            }}
          >
            <div style={{ fontSize: 16, color: "#8a8f9c", textTransform: "uppercase", letterSpacing: 1.5 }}>
              Trust Score
            </div>
            <div style={{ fontSize: 132, fontWeight: 800, color: scoreColor, lineHeight: 1, marginTop: 8 }}>
              {score.total}
            </div>
            {score.qualified && (
              <div style={{ marginTop: 12, fontSize: 18, color: "#7cf2c8" }}>
                Qualified
              </div>
            )}
          </div>

          {/* Address + headline stats */}
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 4 }}>
            {/* Satori has no bundled monospace; fall back to inherited system-ui */}
            <div style={{ fontSize: 28, color: "#e7e9ee" }}>
              {shortAddr(buyer.address, 10, 8)}
            </div>
            <div style={{ display: "flex", gap: 48, marginTop: 36 }}>
              <Stat label="USDC settled" value={fmtUsd(buyer.total_settled_usdc)} />
              <Stat label="Sessions" value={fmtNum(buyer.total_sessions)} />
              <Stat label="Sellers" value={fmtNum(buyer.unique_sellers)} />
            </div>
          </div>
        </div>

        <div style={{ flexGrow: 1 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 18,
            color: "#8a8f9c",
            borderTopWidth: 1,
            borderTopStyle: "solid",
            borderTopColor: "#1f2230",
            paddingTop: 20,
          }}
        >
          <div>antfeed.org/buyers/{shortAddr(buyer.address, 6, 4)}</div>
          <div>On-chain buyer intelligence</div>
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
