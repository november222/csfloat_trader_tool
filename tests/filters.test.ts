import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryOf } from "../lib/category.ts";
import { sortRows } from "../lib/sort.ts";
import type { PnlRow } from "../lib/types.ts";

test("phân loại dao, găng tay và các loại súng", () => {
  assert.equal(categoryOf("★ Karambit | Doppler (Factory New)"), "knife");
  assert.equal(categoryOf("★ StatTrak™ M9 Bayonet | Fade (Factory New)"), "knife");
  assert.equal(categoryOf("★ Butterfly Knife"), "knife");
  assert.equal(categoryOf("★ Sport Gloves | Vice (Field-Tested)"), "gloves");
  assert.equal(categoryOf("★ Hand Wraps | Cobalt Skulls (Field-Tested)"), "gloves");
  assert.equal(categoryOf("AK-47 | Redline (Field-Tested)"), "rifle");
  assert.equal(categoryOf("StatTrak™ M4A1-S | Hyper Beast (Minimal Wear)"), "rifle");
  assert.equal(categoryOf("AWP | Dragon Lore (Field-Tested)"), "sniper");
  assert.equal(categoryOf("Desert Eagle | Blaze (Factory New)"), "pistol");
  assert.equal(categoryOf("Souvenir Glock-18 | Fade (Factory New)"), "pistol");
  assert.equal(categoryOf("P90 | Asiimov (Field-Tested)"), "smg");
  assert.equal(categoryOf("Nova | Hyper Beast (Field-Tested)"), "shotgun");
  assert.equal(categoryOf("M249 | Nebula Crusader (Field-Tested)"), "machinegun");
  assert.equal(categoryOf("Sticker | Titan (Holo) | Katowice 2014"), "other");
  assert.equal(categoryOf("Dreams & Nightmares Case"), "other");
});

const row = (key: string, o: Partial<PnlRow> & { buyCents?: number; buyAt?: string; sellCents?: number; sellAt?: string }): PnlRow => {
  const item = { marketHashName: key, floatValue: 0.1, paintSeed: 1, defIndex: null, paintIndex: null, assetId: null, iconUrl: null };
  return {
    key,
    status: "sold",
    item,
    buy: o.buyCents != null ? { tradeId: `b${key}`, listingId: null, role: "buyer", priceCents: o.buyCents, at: o.buyAt ?? "", item } : null,
    sell: o.sellCents != null ? { tradeId: `s${key}`, listingId: null, role: "seller", priceCents: o.sellCents, at: o.sellAt ?? "", item } : null,
    listing: null,
    netCents: null,
    profitCents: o.profitCents ?? null,
    profitPct: null,
    estProfitCents: null,
    estProfitPct: null,
  };
};

test("sắp xếp theo giá mua tăng/giảm, dòng thiếu dữ liệu nằm cuối", () => {
  const rows = [row("a", { buyCents: 500 }), row("b", {}), row("c", { buyCents: 100 }), row("d", { buyCents: 900 })];
  assert.deepEqual(sortRows(rows, "buyPrice", "asc").map((r) => r.key), ["c", "a", "d", "b"]);
  assert.deepEqual(sortRows(rows, "buyPrice", "desc").map((r) => r.key), ["d", "a", "c", "b"]);
});

test("sắp xếp theo ngày mua và ngày bán; ngày trống (nhập tay) nằm cuối", () => {
  const rows = [
    row("a", { buyCents: 1, buyAt: "2026-03-01T00:00:00Z", sellCents: 2, sellAt: "2026-04-01T00:00:00Z" }),
    row("b", { buyCents: 1, buyAt: "2026-01-01T00:00:00Z", sellCents: 2, sellAt: "" }),
    row("c", { buyCents: 1, buyAt: "2026-02-01T00:00:00Z", sellCents: 2, sellAt: "2026-02-15T00:00:00Z" }),
  ];
  assert.deepEqual(sortRows(rows, "buyDate", "desc").map((r) => r.key), ["a", "c", "b"]);
  assert.deepEqual(sortRows(rows, "buyDate", "asc").map((r) => r.key), ["b", "c", "a"]);
  assert.deepEqual(sortRows(rows, "sellDate", "desc").map((r) => r.key), ["a", "c", "b"]);
});

test("sắp xếp theo lãi/lỗ và giữ nguyên thứ tự khi chọn mặc định", () => {
  const rows = [row("a", { profitCents: -300 }), row("b", { profitCents: 700 }), row("c", { profitCents: 50 })];
  assert.deepEqual(sortRows(rows, "profit", "desc").map((r) => r.key), ["b", "c", "a"]);
  assert.deepEqual(sortRows(rows, "default", "asc").map((r) => r.key), ["a", "b", "c"]);
});
