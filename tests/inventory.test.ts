import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInventory, normalizeCsfloatInventory, parseSteamId, type InvItem } from "../lib/inventory.ts";

test("parseSteamId nhận SteamID64 và link /profiles/, từ chối link /id/ và chuỗi sai", () => {
  assert.equal(parseSteamId("76561198000000000"), "76561198000000000");
  assert.equal(parseSteamId(" https://steamcommunity.com/profiles/76561198000000001/ "), "76561198000000001");
  assert.equal(parseSteamId("https://steamcommunity.com/id/someone"), null);
  assert.equal(parseSteamId("12345"), null);
});

test("normalizeCsfloatInventory đọc mảng trần, đối tượng có data, và món bọc trong item", () => {
  const raw = [
    { asset_id: "1", market_hash_name: "AK-47 | Redline (Field-Tested)", icon_url: "abc", float_value: 0.2, paint_seed: 5 },
    { asset_id: "2", market_hash_name: "Dreams & Nightmares Case", icon_url: "def" },
    { asset_id: "3", market_hash_name: "AWP | Asiimov (Field-Tested)", float_value: 0.3, paint_seed: 9, listing_id: "L77" },
    { market_hash_name: "không có asset_id thì bỏ qua" },
  ];
  for (const data of [raw, { data: raw }, { inventory: raw }]) {
    const items = normalizeCsfloatInventory(data);
    assert.ok(items);
    assert.equal(items.length, 3);
    assert.equal(items[0].floatValue, 0.2);
    assert.equal(items[0].paintSeed, 5);
    assert.equal(items[0].listingId, null);
    assert.equal(items[1].floatValue, null);
    assert.equal(items[2].listingId, "L77");
  }
  const wrapped = normalizeCsfloatInventory({
    data: [{ listing_id: "L1", item: { asset_id: "9", market_hash_name: "P90 | Asiimov (Field-Tested)", float_value: 0.4 } }],
  });
  assert.ok(wrapped);
  assert.equal(wrapped[0].assetId, "9");
  assert.equal(wrapped[0].listingId, "L1");
  assert.equal(normalizeCsfloatInventory(null), null);
  assert.equal(normalizeCsfloatInventory({ success: 0 }), null);
});

const it = (assetId: string, name: string, floatValue: number | null = null): InvItem => ({
  assetId, name, iconUrl: null, floatValue, paintSeed: null, listingId: null,
});
const keyOf = (x: InvItem) => `${x.name}|${x.floatValue ?? "nofloat"}`;

test("classifyInventory khớp theo tên + float: cùng tên khác float không khớp, thiếu thì báo missing", () => {
  const inv = [it("1", "AK", 0.1), it("2", "AK", 0.2), it("3", "Case"), it("4", "Case"), it("5", "AWP", 0.3)];
  const holding = {
    "AK|0.1": { name: "AK", floatValue: 0.1, count: 1 },
    "Case|nofloat": { name: "Case", floatValue: null, count: 1 },
    "Knife|0.05": { name: "Knife", floatValue: 0.05, count: 1 },
  };
  const { items, missing } = classifyInventory(inv, holding, keyOf);
  assert.deepEqual(items.map((x) => x.source), ["csfloat", "other", "csfloat", "other", "other"]);
  assert.deepEqual(missing, [{ name: "Knife", floatValue: 0.05, count: 1 }]);
});
