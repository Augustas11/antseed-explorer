import { NextResponse } from "next/server";
import { getNetworkStats, getDailyVolume, getProfileDrift } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  // Serialized — Promise.all of many Neon HTTP requests from a cold Vercel
  // serverless instance occasionally returned empty rows. Sequential calls
  // are still <500ms total and 100% reliable.
  const stats = await getNetworkStats();
  const daily = await getDailyVolume(30);
  const drift = await getProfileDrift();
  return NextResponse.json({ ...stats, daily, drift });
}
