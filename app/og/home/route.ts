import React from "react";
import { ImageResponse } from "next/og";
import {
  HOME_OG_SIZE,
  HomeOgCard,
  type HomeOgMetrics,
} from "@/lib/og/home-card";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const metrics: HomeOgMetrics = {
    buyers: parseMetric(params.get("buyers")),
    usdc: parseMetric(params.get("usdc")),
    sessions: parseMetric(params.get("sessions")),
  };

  const image = new ImageResponse(
    React.createElement(HomeOgCard, metrics),
    HOME_OG_SIZE,
  );
  image.headers.set("Cache-Control", "no-store, max-age=0");
  return image;
}

function parseMetric(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
