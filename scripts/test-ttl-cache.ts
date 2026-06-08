import assert from "node:assert/strict";
import { createTtlCache } from "../lib/ttlCache";

async function main() {
  let now = 1_000;
  let calls = 0;
  const cache = createTtlCache(async () => {
    calls += 1;
    return calls;
  }, 300, () => now);

  assert.equal(await cache.get(), 1);
  assert.equal(await cache.get(), 1);
  assert.equal(calls, 1);

  now += 299;
  assert.equal(await cache.get(), 1);
  assert.equal(calls, 1);

  now += 1;
  assert.equal(await cache.get(), 2);
  assert.equal(calls, 2);

  const releaseRef: { current: ((value: string) => void) | null } = { current: null };
  let singleFlightCalls = 0;
  const singleFlight = createTtlCache(
    async () =>
      new Promise<string>((resolve) => {
        singleFlightCalls += 1;
        releaseRef.current = resolve;
      }),
    300,
    () => now,
  );

  const first = singleFlight.get();
  const second = singleFlight.get();
  assert.equal(singleFlightCalls, 1);
  const release = releaseRef.current;
  if (!release) throw new Error("single-flight loader did not expose release callback");
  release("shared");
  assert.equal(await first, "shared");
  assert.equal(await second, "shared");

  console.log("ttl cache checks passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
