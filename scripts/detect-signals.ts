// CLI entry for the signal detector.
//
// Usage:
//   DATABASE_URL=… npx tsx scripts/detect-signals.ts            # write cards
//   DATABASE_URL=… npx tsx scripts/detect-signals.ts --dry      # detect only
//   ANTFEED_SIGNALS_DIR=/abs/path npx tsx scripts/detect-signals.ts
//
// Default outDir is the sibling antfeed repo: ../antfeed/marketing/signals.
// Falls back to ./marketing/signals inside the explorer repo if the sibling
// doesn't exist, so the script is self-contained for testing.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { runDetectors } from "../lib/signals/run";

function resolveOutDir(): string {
  if (process.env.ANTFEED_SIGNALS_DIR) {
    return path.resolve(process.env.ANTFEED_SIGNALS_DIR);
  }
  const sibling = path.resolve(__dirname, "../../antfeed/marketing/signals");
  if (fs.existsSync(path.resolve(__dirname, "../../antfeed/marketing"))) {
    return sibling;
  }
  return path.resolve(__dirname, "../marketing/signals");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry");
  const outDir = resolveOutDir();

  console.log(`[signals] outDir=${outDir}${dryRun ? " (dry-run)" : ""}`);
  const r = await runDetectors({ outDir, dryRun });

  console.log(
    `[signals] detected=${r.detected} written=${r.written} skippedSameDay=${r.skippedAlreadyEmittedToday} skippedFileExists=${r.skippedFileExists}`,
  );
  for (const s of r.signals) {
    const tag = s.written ? "WROTE" : "skip";
    console.log(
      `[signals] ${tag} imp=${s.importance.toString().padStart(2)} ${s.kind} -> ${s.filename}`,
    );
    console.log(`            ${s.headline}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
