import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://base.drpc.org";
const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);

export const chain = CHAIN_ID === 84532 ? baseSepolia : base;

// 8 s timeout + 1 retry = 16 s max per RPC call.  The manual sync route has a
// 60 s Vercel limit and a 25 s soft deadline; individual calls must finish well
// inside that or the function is killed and returns an empty 504 body. Local
// one-shot scripts can override via RPC_TIMEOUT_MS for wide-range getLogs calls.
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 8_000);
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }),
});

export const explorerBaseUrl =
  CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
