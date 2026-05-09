import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);

export const chain = CHAIN_ID === 84532 ? baseSepolia : base;

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

export const explorerBaseUrl =
  CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
