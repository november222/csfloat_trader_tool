import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSurvey, floatRange } from "../lib/survey.ts";

const l = (id: string, priceCents: number, floatValue: number | null) => ({ id, priceCents, floatValue, iconUrl: null });

test("khoảng float được kẹp trong [0, 1]", () => {
  assert.deepEqual(floatRange(0.0005, 0.001), { floatMin: 0, floatMax: 0.0015 });
  assert.equal(floatRange(0.9995, 0.001).floatMax, 1);
});

test("buildSurvey: min/trung vị/max và listing float gần nhất", () => {
  const r = buildSurvey([l("a", 300, 0.2005), l("b", 100, 0.2001), l("c", 200, 0.2), l("d", 400, null)], 0.2, 0.001);
  assert.equal(r.count, 4);
  assert.equal(r.minCents, 100);
  assert.equal(r.maxCents, 400);
  assert.equal(r.medianCents, 250);
  assert.equal(r.closest[0].id, "c");
  assert.equal(r.closest[r.closest.length - 1].id, "d");
});

test("buildSurvey: không có listing", () => {
  const r = buildSurvey([], 0.3, 0.001);
  assert.equal(r.count, 0);
  assert.equal(r.minCents, null);
  assert.equal(r.medianCents, null);
});
