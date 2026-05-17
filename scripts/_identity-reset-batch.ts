import "dotenv/config";
import { setState, getState } from "../lib/db";

(async () => {
  const before = await getState("log_batch_size_identity_registry");
  await setState("log_batch_size_identity_registry", "50000");
  const after = await getState("log_batch_size_identity_registry");
  console.log(`batch_size: ${before} -> ${after}`);
  console.log("cursor:", await getState("last_indexed_block_identity_registry"));
})();
