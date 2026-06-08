import { NextResponse } from "next/server";
import { resolveSearchMatches } from "@/lib/searchResolver";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const matches = await resolveSearchMatches(q, 8);
  return NextResponse.json({ matches });
}
