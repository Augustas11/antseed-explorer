import { NextRequest, NextResponse } from "next/server";
import { sync, refreshProviderDirectory } from "@/lib/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const result = await sync({ force });
  await refreshProviderDirectory();
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  return POST(req);
}
