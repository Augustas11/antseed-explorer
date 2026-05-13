import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/schema";
import { desc } from "drizzle-orm";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;

  const key = randomBytes(32).toString("hex");
  await db.insert(apiKeys).values({ key, label, createdAt: Date.now() });

  return NextResponse.json({ key, label, createdAt: Date.now() }, { status: 201 });
}
