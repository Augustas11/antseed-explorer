import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/schema";
import { desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const expected = process.env.API_KEYS_ADMIN_SECRET || process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(getClientIp(req), null);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const rows = await db
    .select({ key: apiKeys.key, label: apiKeys.label, createdAt: apiKeys.createdAt })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({
    keys: rows.map((r) => ({
      key: `${r.key.slice(0, 8)}…${r.key.slice(-4)}`,
      label: r.label,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Use IP bucket only — never grant key-tier rate limit on key minting itself.
  const rl = await checkRateLimit(getClientIp(req), null);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;

  const key = randomBytes(32).toString("hex");
  const createdAt = Date.now();
  await db.insert(apiKeys).values({ key, label, createdAt });

  return NextResponse.json({ key, label, createdAt }, { status: 201 });
}
