import assert from "node:assert/strict";
import {
  BuyerDetailResponseZ,
  BuyerScoreResponseZ,
  BuyersPageZ,
  ChannelRowZ,
  ChannelsPageZ,
  DauTrendResponseZ,
  GasResponseZ,
  NetworkStatsResponseZ,
  ProvidersPageZ,
  SellerServicesResponseZ,
  SellersPageZ,
} from "../antfeed-mcp/src/schemas";

const configuredBaseUrl = process.env.API_RUNTIME_BASE_URL;
assert.ok(
  configuredBaseUrl,
  "API_RUNTIME_BASE_URL is required; point it at a local preview or an explicitly chosen deployment",
);
const baseUrl = configuredBaseUrl.replace(/\/$/, "");

async function fetchJson(path: string) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url);
  assert.equal(res.ok, true, `${url} returned ${res.status}`);
  assert.match(
    res.headers.get("content-type") ?? "",
    /application\/json/,
    `${url} must return JSON`,
  );
  return res.json();
}

async function main() {
  const buyers = BuyersPageZ.parse(await fetchJson("/api/buyers?limit=1"));
  const sellers = SellersPageZ.parse(await fetchJson("/api/sellers?limit=1"));
  const channels = ChannelsPageZ.parse(await fetchJson("/api/channels?limit=1"));
  const providers = ProvidersPageZ.parse(await fetchJson("/api/providers?limit=1"));
  const stats = NetworkStatsResponseZ.parse(await fetchJson("/api/stats"));
  const gas = GasResponseZ.parse(await fetchJson("/api/gas"));
  const dau = DauTrendResponseZ.parse(await fetchJson("/api/metrics/dau"));

  assert.ok(buyers.buyers.length > 0, "runtime buyers page should include a representative row");
  assert.ok(sellers.sellers.length > 0, "runtime sellers page should include a representative row");
  assert.ok(channels.channels.length > 0, "runtime channels page should include a representative row");
  assert.ok(providers.providers.length > 0, "runtime providers page should include a representative row");
  assert.equal(typeof stats.totalSessions, "number", "runtime stats should include totalSessions");
  assert.ok(gas.gwei === null || gas.gwei >= 0, "runtime gas should parse");
  assert.ok(dau.length > 0, "runtime DAU response should include representative rows");

  const buyerAddress = buyers.buyers[0].address;
  const sellerAddress = sellers.sellers[0].address;
  const channelId = channels.channels[0].channel_id;

  BuyerDetailResponseZ.parse(await fetchJson(`/api/buyers/${buyerAddress}`));
  BuyerScoreResponseZ.parse(await fetchJson(`/api/score/${buyerAddress}`));
  SellerServicesResponseZ.parse(await fetchJson(`/api/sellers/${sellerAddress}/services`));
  ChannelRowZ.parse(await fetchJson(`/api/channels/${channelId}`));

  console.log(`Runtime API contract checks passed for ${baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
