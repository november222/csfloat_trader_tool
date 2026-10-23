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

test("giá mua nhập tay biến 'bán không rõ giá mua' thành 'đã bán' có lãi/lỗ", () => {
  const sell = trade("9", "seller", 10000, "2026-02-01T00:00:00Z", 0.55);
  const before = buildPnl([sell], 2);
  assert.equal(before[0].status, "sold_unknown_buy");
  const key = before[0].key;

  const after = buildPnl([sell], 2, [], { [key]: 8000 });
  assert.equal(after[0].status, "sold");
  assert.equal(after[0].manualBuy, true);
  assert.equal(after[0].profitCents, Math.round(10000 * 0.98) - 8000);
  const s = summarize(after);
  assert.equal(s.soldCount, 1);
  assert.equal(s.unknownBuyCount, 0);
  assert.equal(s.realizedProfitCents, 1800);
});

test("giá mua nhập tay cho món đang rao không rõ giá mua tính lãi/lỗ ước tính", () => {
  const listing = {
    listingId: "LIVE3",
    priceCents: 20000,
    at: "2026-02-01T00:00:00Z",
    type: "buy_now",
    item: item(0.91),
  };
  const key = buildPnl([], 2, [listing])[0].key;
  const rows = buildPnl([], 2, [listing], { [key]: 15000 });
  assert.equal(rows[0].status, "listed");
  assert.equal(rows[0].estProfitCents, Math.round(20000 * 0.98) - 15000);
  assert.equal(summarize(rows).listedCostCents, 15000);
});
