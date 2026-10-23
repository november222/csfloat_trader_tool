import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInventory, normalizeInventory, parseSteamId } from "../lib/inventory.ts";

test("parseSteamId nhận SteamID64 và link /profiles/, từ chối link /id/ và chuỗi sai", () => {
  assert.equal(parseSteamId("76561198000000000"), "76561198000000000");
  assert.equal(parseSteamId(" https://steamcommunity.com/profiles/76561198000000001/ "), "76561198000000001");
  assert.equal(parseSteamId("https://steamcommunity.com/id/someone"), null);
  assert.equal(parseSteamId("12345"), null);
});

test("normalizeInventory ghép assets với descriptions và bỏ app khác CS2", () => {
  const data = {
    success: 1,
    total_inventory_count: 3,
    assets: [
      { appid: 730, contextid: "2", assetid: "100", classid: "1", instanceid: "0", amount: "1" },
      { appid: 730, contextid: "2", assetid: "101", classid: "2", instanceid: "0", amount: "1" },
      { appid: 440, contextid: "2", assetid: "102", classid: "1", instanceid: "0", amount: "1" },
    ],
    descriptions: [
      { classid: "1", instanceid: "0", market_hash_name: "AK-47 | Redline (Field-Tested)", icon_url: "abc", tradable: 1, marketable: 1, type: "Classified Rifle" },
      { classid: "2", instanceid: "0", market_hash_name: "Dreams & Nightmares Case", icon_url: "def", tradable: 0, marketable: 1, cache_expiration: "2999-01-01T00:00:00Z" },
    ],
    more_items: 1,
    last_assetid: "101",
  };
  const page = normalizeInventory(data);
  assert.ok(page);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].name, "AK-47 | Redline (Field-Tested)");
  assert.equal(page.items[0].tradable, true);
  assert.equal(page.items[1].tradable, false);
  assert.equal(page.items[1].tradableAfter, "2999-01-01T00:00:00Z");
  assert.equal(page.more, true);
  assert.equal(page.lastAssetId, "101");
  assert.equal(page.total, 3);
  assert.equal(normalizeInventory(null), null);
  assert.equal(normalizeInventory({ success: 0 }), null);
});

const it = (assetId: string, name: string) => ({
  assetId, name, iconUrl: null, tradable: true, marketable: true, type: null, tradableAfter: null,
});

test("classifyInventory đếm theo tên: phần dư là ngoài CSFloat, thiếu thì báo missing", () => {
  const inv = [it("1", "AK"), it("2", "AK"), it("3", "AK"), it("4", "Case"), it("5", "AWP")];
  const { items, missing } = classifyInventory(inv, { AK: 2, AWP: 1, Knife: 1 });
  assert.deepEqual(items.map((x) => x.source), ["csfloat", "csfloat", "other", "other", "csfloat"]);
  assert.deepEqual(missing, [{ name: "Knife", count: 1 }]);
});
