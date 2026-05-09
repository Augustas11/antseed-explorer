import { NextRequest, NextResponse } from "next/server";
import { listBuyers, countBuyers } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const limit = Math.min(100, Number(u.searchParams.get("limit") || 25));
  const offset = Number(u.searchParams.get("offset") || 0);
  const qualifiedOnly = u.searchParams.get("qualified") === "1";
  const minScore = Number(u.searchParams.get("minScore") || 0);
  const sort = (u.searchParams.get("sort") || "score") as any;

  const [rows, total] = await Promise.all([
    listBuyers({ limit, offset, qualifiedOnly, minScore, sort }),
    countBuyers({ qualifiedOnly, minScore }),
  ]);
  return NextResponse.json({ buyers: rows, total, limit, offset });
}
