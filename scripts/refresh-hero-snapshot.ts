import "dotenv/config";
import { refreshHeroSnapshot } from "../lib/queries";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const hero = await refreshHeroSnapshot();
  console.log(
    JSON.stringify({
      ok: true,
      at: hero.at,
      atIso: new Date(hero.at).toISOString(),
      sourceLastSyncTs: hero.source.lastSyncTs,
      sourceLastIndexedBlock: hero.source.lastIndexedBlock,
      diemSnapshotAt: hero.source.diemSnapshotAt,
      diemExactAddresses: hero.stats.diemExactAddresses,
      totalRevenueUsdc: hero.stats.totalRevenueUsdc,
      totalTokens: hero.stats.totalTokens,
      totalPayingUsers: hero.stats.totalPayingUsers,
      sparklineDays: hero.sparklines.length,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
