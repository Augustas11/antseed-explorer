import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://base.drpc.org";
const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);

export const chain = CHAIN_ID === 84532 ? baseSepolia : base;

// 8 s timeout + 1 retry = 16 s max per RPC call.  The manual sync route has a
// 60 s Vercel limit and a 25 s soft deadline; individual calls must finish well
// inside that or the function is killed and returns an empty 504 body.
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 8_000, retryCount: 1 }),
});

export const explorerBaseUrl =
  CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
