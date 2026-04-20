// Ping OnchainOS to verify the 4 OKX env vars work against the live API.
// Calls GET /api/v5/wallet/account/list (no side effect, no gas, no spend).
//
// Run:
//   cd skill && npx tsx scripts/ping-onchainos.ts

import { request, OnchainOSError } from "../src/onchainos/client.js";

async function main() {
  console.log("Pinging OnchainOS with your API credentials...\n");

  try {
    const result = await request<{ accounts: unknown[] }>(
      "GET",
      "/api/v5/wallet/account/list",
      { query: { limit: 1 } },
    );
    const n = Array.isArray(result?.accounts) ? result.accounts.length : 0;
    console.log(`✅ Auth OK. Wallets in project: ${n} (can be 0 — means API is healthy).`);
    process.exit(0);
  } catch (err) {
    if (err instanceof OnchainOSError) {
      console.error(`❌ OnchainOS rejected the call:`);
      console.error(`   status: ${err.status}`);
      console.error(`   code:   ${err.code}`);
      console.error(`   msg:    ${err.message}`);
      if (err.data) console.error(`   data:`, err.data);
      process.exit(1);
    }
    throw err;
  }
}

main().catch(e => {
  console.error("Unexpected:", e);
  process.exit(2);
});
