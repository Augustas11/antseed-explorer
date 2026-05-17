import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { identityRegistryAbi, CONTRACTS } from "../lib/antseed";

const RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://base.blockpi.network/v1/rpc/public",
];

async function probe(url: string, range: bigint) {
  const c = createPublicClient({
    chain: base,
    transport: http(url, { timeout: 30_000, retryCount: 0 }),
  });
  const from = 44_548_000n;
  const to = from + range - 1n;
  const t0 = Date.now();
  try {
    const logs = await c.getLogs({
      address: CONTRACTS.IdentityRegistry as `0x${string}`,
      events: identityRegistryAbi as any,
      fromBlock: from,
      toBlock: to,
    });
    return { ok: true, ms: Date.now() - t0, count: logs.length };
  } catch (e: any) {
    const msg = (e?.message || String(e)).replace(/\n/g, " ").slice(0, 180);
    return { ok: false, ms: Date.now() - t0, msg };
  }
}

async function main() {
  for (const url of RPCS) {
    process.stdout.write(`\n=== ${url}\n`);
    for (const r of [50_000n, 20_000n, 10_000n, 5_000n]) {
      const res = await probe(url, r);
      if (res.ok) {
        console.log(`  range=${r} OK ms=${res.ms} logs=${res.count}`);
      } else {
        console.log(`  range=${r} ERR ms=${res.ms} msg=${res.msg}`);
        break;
      }
    }
  }
}
main();
