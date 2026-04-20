// Ping OnchainOS via compiled dist to avoid tsx platform mismatch.
// Run: node skill/scripts/ping-onchainos.mjs  (after `source .env`)

import { request, OnchainOSError } from "../dist/onchainos/client.js";

async function main() {
  console.log("Pinging OnchainOS (GET /api/v5/wallet/account/list)...\n");
  try {
    const result = await request(
      "GET",
      "/api/v5/wallet/account/list",
      { query: { limit: 1 } },
    );
    const n = Array.isArray(result?.accounts) ? result.accounts.length : 0;
    console.log(`✅ Auth OK. Wallets in project: ${n}`);
    console.log(`   (0 is healthy — means the project has no wallet yet.)`);
    process.exit(0);
  } catch (err) {
    if (err instanceof OnchainOSError) {
      console.error(`❌ OnchainOS rejected:`);
      console.error(`   status=${err.status}  code=${err.code}`);
      console.error(`   msg=${err.message}`);
      if (err.data) console.error(`   data=`, err.data);
      process.exit(1);
    }
    console.error("Unexpected:", err);
    process.exit(2);
  }
}

main();
