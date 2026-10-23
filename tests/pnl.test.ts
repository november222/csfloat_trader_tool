import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPnl, netAfterFee, summarize } from "../lib/pnl.ts";

const item = (float: number, seed = 1) => ({
  marketHashName: "AK-47 | Redline (Field-Tested)",
  floatValue: float,
  paintSeed: seed,
  defIndex: 7,
  paintIndex: 282,
  assetId: null,
  iconUrl: "icon",
});

const trade = (id: string, role: "buyer" | "seller", priceCents: number, at: string, float = 0.2) => ({
  tradeId: id,
  listingId: `L${id}`,
  role,
  priceCents,
  at,
  item: item(float),
});

test("phí 2% được trừ khỏi giá bán", () => {
  assert.equal(netAfterFee(10000, 2), 9800);
});

test("ghép mua-bán và tính lãi/lỗ sau phí", () => {
  const rows = buildPnl(
    [
      trade("1", "buyer", 9000, "2026-01-01T00:00:00Z"),
      trade("2", "seller", 10000, "2026-01-05T00:00:00Z"),
    ],
    2,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "sold");
  assert.equal(rows[0].netCents, 9800);
  assert.equal(rows[0].profitCents, 800);
});

test("bán lỗ khi giá bán sau phí thấp hơn giá mua", () => {
  const rows = buildPnl(
    [
      trade("1", "buyer", 10000, "2026-01-01T00:00:00Z"),
      trade("2", "seller", 10100, "2026-01-02T00:00:00Z"),
    ],
    2,
  );
  assert.equal(rows[0].profitCents, Math.round(10100 * 0.98) - 10000);
  assert.ok((rows[0].profitCents ?? 0) < 0);
});

test("món chưa bán là đang giữ, món bán không có lệnh mua là không rõ giá mua", () => {
  const rows = buildPnl(
    [
      trade("1", "buyer", 5000, "2026-01-01T00:00:00Z", 0.11),
      trade("2", "seller", 7000, "2026-01-02T00:00:00Z", 0.33),
    ],
    2,
  );
  const s = summarize(rows);
  assert.equal(s.holdingCount, 1);
  assert.equal(s.unknownBuyCount, 1);
  assert.equal(s.soldCount, 0);
});

test("mua-bán-mua-bán cùng một món ghép đúng từng cặp", () => {
  const rows = buildPnl(
    [
      trade("1", "buyer", 1000, "2026-01-01T00:00:00Z"),
      trade("2", "seller", 1500, "2026-01-02T00:00:00Z"),
      trade("3", "buyer", 1400, "2026-01-03T00:00:00Z"),
      trade("4", "seller", 1600, "2026-01-04T00:00:00Z"),
    ],
    2,
  );
  const sold = rows.filter((r) => r.status === "sold");
  assert.equal(sold.length, 2);
  const total = sold.reduce((a, r) => a + (r.profitCents ?? 0), 0);
  assert.equal(total, Math.round(1500 * 0.98) - 1000 + (Math.round(1600 * 0.98) - 1400));
});

test("món đã mua và đang rao trong stall là 'Đang bán', ước tính lãi/lỗ theo giá rao sau phí", () => {
  const listing = {
    listingId: "LIVE1",
    priceCents: 12000,
    at: "2026-01-10T00:00:00Z",
    type: "buy_now",
    item: item(0.2),
  };
  const rows = buildPnl([trade("1", "buyer", 10000, "2026-01-01T00:00:00Z")], 2, [listing]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "listed");
  assert.equal(rows[0].netCents, Math.round(12000 * 0.98));
  assert.equal(rows[0].estProfitCents, Math.round(12000 * 0.98) - 10000);
  const s = summarize(rows);
  assert.equal(s.listedCount, 1);
  assert.equal(s.holdingCount, 0);
  assert.equal(s.listedAskCents, 12000);
});

test("listing không có lệnh mua tương ứng được đánh dấu không rõ giá mua", () => {
  const listing = {
    listingId: "LIVE2",
    priceCents: 5000,
    at: "2026-01-10T00:00:00Z",
    type: "buy_now",
    item: item(0.77),
  };
  const rows = buildPnl([], 2, [listing]);
  assert.equal(rows[0].status, "listed_unknown_buy");
  assert.equal(summarize(rows).unknownBuyCount, 1);
});
