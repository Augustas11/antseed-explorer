// Apply pending Drizzle migrations against the Neon Postgres DB using the
// same HTTP driver the app uses at runtime. Avoids drizzle-kit's `migrate`
// command, which expects a websocket-capable driver and fails in Vercel build.
//
// Usage (run by `npm run vercel-build`):
//   DATABASE_URL=… npx tsx scripts/migrate.ts

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set; skipping migrations.");
    process.exit(0); // Don't fail the build — runtime will surface the error.
  }
  console.log("Applying migrations…");
  const sql = neon(url);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
