// One-shot: verify the deployment block of the IdentityRegistry proxy at
// 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 via viem getBytecode bisection,
// the same approach used for the other DEPLOYMENT_BLOCK constants in
// lib/antseed.ts. Run with:
//   DATABASE_URL=... RPC_URL=... npx tsx scripts/_identity-bisect.ts

import "dotenv/config";
import { publicClient } from "../lib/chain";

const ADDR = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

async function hasCode(bn: bigint): Promise<boolean> {
  const code = await publicClient.getBytecode({ address: ADDR, blockNumber: bn });
  return !!code && code !== "0x";
}

async function main() {
  const claimed = 41_663_783n; // from Basescan creation tx
  console.log(`Sanity around claimed block ${claimed}`);
  console.log(`  ${claimed - 1n}: hasCode=${await hasCode(claimed - 1n)}`);
  console.log(`  ${claimed}: hasCode=${await hasCode(claimed)}`);
  console.log(`  ${claimed + 1n}: hasCode=${await hasCode(claimed + 1n)}`);

  let lo = 30_000_000n;
  let hi = claimed + 10n;
  console.log(`Bisect lo=${lo} hi=${hi}`);
  console.log(`  hasCode(${lo})=${await hasCode(lo)}`);
  console.log(`  hasCode(${hi})=${await hasCode(hi)}`);
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    const c = await hasCode(mid);
    console.log(`  mid=${mid} hasCode=${c}`);
    if (c) hi = mid; else lo = mid;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\nFirst block with code: ${hi}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
