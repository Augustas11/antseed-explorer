// Local CLI sync against the configured DATABASE_URL. Useful for debugging
// the indexer without running the dev server.
//
//   DATABASE_URL=… RPC_URL=… npx tsx scripts/sync-cli.ts
//   DATABASE_URL=… RPC_URL=… npx tsx scripts/sync-cli.ts loop

import "dotenv/config";
import { sync, refreshProviderDirectory } from "../lib/indexer";

async function main() {
  const loop = process.argv.includes("loop");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  for (let i = 1; i <= (loop ? 50 : 1); i++) {
    const r = await sync({ force: true, deadlineMs: 50_000 });
    console.log(`pass ${i}: ${JSON.stringify(r)}`);
    if (r.skipped === "caught up" || r.skipped === "debounced") {
      console.log("✓ caught up to chain head.");
      break;
    }
    if (!r.ok) break;
  }
  await refreshProviderDirectory();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
