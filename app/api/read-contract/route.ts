import { NextRequest, NextResponse } from "next/server";
import { isAddress, isHex } from "viem";
import { publicClient } from "@/lib/chain";
import { channelsViewAbi, CONTRACTS } from "@/lib/antseed";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channelsAddress = CONTRACTS.AntseedChannels as `0x${string}`;

// Allowlisted function names only — prevents arbitrary contract calls.
type AllowedFn = "getChannel" | "balanceOf";
const ALLOWED = new Set<AllowedFn>(["getChannel", "balanceOf"]);

// Per-function arg validators — short-circuit before hitting the RPC.
const ARG_VALIDATORS: Record<AllowedFn, (args: unknown[]) => unknown[] | null> = {
  getChannel: (a) =>
    a.length === 1 && typeof a[0] === "string" && isHex(a[0]) && a[0].length === 66
      ? [a[0] as `0x${string}`]
      : null,
  balanceOf: (a) =>
    a.length === 1 && typeof a[0] === "string" && isAddress(a[0])
      ? [a[0] as `0x${string}`]
      : null,
};

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
  const rl = await checkRateLimit(getClientIp(req), req.headers.get("x-api-key"));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.fnName !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const fnName = body.fnName as string;
  if (!ALLOWED.has(fnName as AllowedFn)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 400 });
  }

  const rawArgs: unknown[] = Array.isArray(body.args) ? body.args : [];
  const args = ARG_VALIDATORS[fnName as AllowedFn](rawArgs);
  if (!args) {
    return NextResponse.json({ error: "invalid_args" }, { status: 400 });
  }

  try {
    const result = await publicClient.readContract({
      address: channelsAddress,
      abi: channelsViewAbi as any,
      functionName: fnName,
      args,
    });
    return NextResponse.json({ ok: true, result: serializeBigInt(result) });
  } catch {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 502 });
  }
}
