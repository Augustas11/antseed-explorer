import { NextResponse } from "next/server";
import { getNetworkStats, getDailyVolume, getProfileDrift } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, daily, drift] = await Promise.all([
    getNetworkStats(),
    getDailyVolume(30),
    getProfileDrift(),
  ]);
  return NextResponse.json({ ...stats, daily, drift });
}
