import { NextRequest, NextResponse } from "next/server";
import { sync, refreshProviderDirectory } from "@/lib/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST-only. The Sync button issues a same-origin POST; the indexer's 60s
// debounce caps how often a real getLogs pass actually fires. We also reject
// cross-origin Origin headers so the route can't be casually weaponized.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 400 });
    }
    if (host && originHost !== host) {
      return NextResponse.json({ ok: false, error: "cross_origin" }, { status: 403 });
    }
  }
  // No `force=1`: the public route always honors the 60s debounce.
  const result = await sync();
  await refreshProviderDirectory();
  return NextResponse.json(result);
}
