import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/chain";
import { channelsViewAbi, CONTRACTS } from "@/lib/antseed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channelsAddress = CONTRACTS.AntseedChannels as `0x${string}`;

// Allowlisted function names only — prevents arbitrary contract calls.
type AllowedFn = "getChannel" | "balanceOf";
const ALLOWED = new Set<AllowedFn>(["getChannel", "balanceOf"]);

function serializeBigInt(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(serializeBigInt);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as object).map(([k, val]) => [k, serializeBigInt(val)]),
    );
  }
  return v;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.fnName !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const fnName = body.fnName as string;
  if (!ALLOWED.has(fnName as AllowedFn)) {
    return NextResponse.json({ error: "not_allowed", fnName }, { status: 400 });
  }

  const args: unknown[] = Array.isArray(body.args) ? body.args : [];

  try {
    const result = await publicClient.readContract({
      address: channelsAddress,
      abi: channelsViewAbi as any,
      functionName: fnName,
      args,
    });
    return NextResponse.json({ ok: true, result: serializeBigInt(result) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.shortMessage ?? e?.message ?? String(e) },
      { status: 200 },
    );
  }
}
