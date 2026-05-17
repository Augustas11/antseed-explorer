// Probe ranges of various sizes to understand RPC behavior for IdentityRegistry.
import "dotenv/config";
import { publicClient } from "../lib/chain";
import { CONTRACTS, identityRegistryAbi, IDENTITY_REGISTRY_DEPLOYMENT_BLOCK } from "../lib/antseed";

async function tryRange(from: bigint, to: bigint) {
  const t0 = Date.now();
  try {
    const logs = await publicClient.getLogs({
      address: CONTRACTS.IdentityRegistry as `0x${string}`,
      events: identityRegistryAbi as any,
      fromBlock: from,
      toBlock: to,
    });
    console.log(`OK [${from}..${to}] (${to - from + 1n} blocks) → ${logs.length} logs in ${Date.now() - t0}ms`);
    return logs.length;
  } catch (e: any) {
    const m = (e?.message || String(e)).replace(/\s+/g, " ");
    console.log(`ERR [${from}..${to}]: ${m.slice(0, 1500)}`);
    return -1;
  }
}

async function tryRangeSingleEvent(from: bigint, to: bigint) {
  const t0 = Date.now();
  // Just Registered to see if MetadataSet's "string indexed" is the culprit.
  const singleAbi = [identityRegistryAbi[0]];
  try {
    const logs = await publicClient.getLogs({
      address: CONTRACTS.IdentityRegistry as `0x${string}`,
      events: singleAbi as any,
      fromBlock: from,
      toBlock: to,
    });
    console.log(`OK[Registered-only] [${from}..${to}] → ${logs.length} logs in ${Date.now() - t0}ms`);
    return logs.length;
  } catch (e: any) {
    const m = (e?.message || String(e)).replace(/\s+/g, " ");
    console.log(`ERR[Registered-only] [${from}..${to}]: ${m.slice(0, 400)}`);
    return -1;
  }
}

(async () => {
  const head = await publicClient.getBlockNumber();
  console.log(`head=${head}`);
  const start = IDENTITY_REGISTRY_DEPLOYMENT_BLOCK;
  await tryRange(start, start + 100n);
  await tryRange(start, start + 1000n);
  await tryRangeSingleEvent(start, start + 1000n);
  await tryRangeSingleEvent(start, start + 50_000n);
})();
