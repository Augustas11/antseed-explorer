import { ImageResponse } from "next/og";
import { getSeller } from "@/lib/queries";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "Seller profile — AntSeed Explorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function SellerOG({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  try {
    const { address } = await params;
    return await renderSellerOG(address);
  } catch {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#0a0b10",
            color: "#7cf2c8",
            fontSize: 32,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          AntSeed Explorer
        </div>
      ),
      { ...size },
    );
  }
}

async function renderSellerOG(address: string) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#0a0b10",
            color: "#8a8f9c",
            fontSize: 36,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ color: "#7cf2c8", fontSize: 32 }}>
            AntSeed Explorer
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const seller = await getSeller(address).catch(() => null);

  if (!seller) {
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
          <div style={{ color: "#7cf2c8", fontSize: 32 }}>
            AntSeed Explorer
          </div>
          <div style={{ marginTop: 24 }}>Seller not indexed</div>
          <div
            style={{ marginTop: 12, fontSize: 22, fontFamily: "monospace" }}
          >
            {shortAddr(address)}
          </div>
        </div>
      ),
      { ...size },
    );
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
          padding: 70,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{ fontSize: 26, color: "#7cf2c8", fontWeight: 600 }}
          >
            AntSeed
          </div>
          <div style={{ fontSize: 26, color: "#8a8f9c" }}>Explorer</div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ fontSize: 18, color: "#8a8f9c" }}>
            SELLER PROFILE
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 50,
            marginTop: 50,
            alignItems: "flex-start",
          }}
        >
          {/* Address + headline stats */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              marginTop: 4,
            }}
          >
            <div style={{ fontSize: 28, color: "#e7e9ee" }}>
              {shortAddr(seller.address, 10, 8)}
            </div>
            <div style={{ display: "flex", gap: 48, marginTop: 36 }}>
              <Stat
                label="USDC earned"
                value={fmtUsd(seller.total_earned_usdc)}
              />
              <Stat
                label="Sessions"
                value={fmtNum(seller.total_sessions)}
              />
              <Stat
                label="Unique buyers"
                value={fmtNum(seller.unique_buyers)}
              />
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
          <div>
            antfeed.org/sellers/{shortAddr(seller.address, 6, 4)}
          </div>
          <div>On-chain seller intelligence</div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 16,
          color: "#8a8f9c",
          textTransform: "uppercase",
          letterSpacing: 1.2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          color: "#e7e9ee",
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}
