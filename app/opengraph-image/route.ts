import React from "react";
import { ImageResponse } from "next/og";
import { getNetworkStats } from "@/lib/queries";
import { HOME_OG_SIZE, HomeOgCard } from "@/lib/og/home-card";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const stats = await getNetworkStats().catch(() => null);

  const image = new ImageResponse(
    React.createElement(HomeOgCard, {
      buyers: stats?.totalBuyers ?? null,
      usdc: stats?.totalVolumeUsdc ?? null,
      sessions: stats?.totalSessions ?? null,
    }),
    HOME_OG_SIZE,
  );
  image.headers.set("Cache-Control", "no-store, max-age=0");
  return image;
}
