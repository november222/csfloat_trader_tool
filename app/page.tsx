"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NormTrade, PnlRow, SurveyResult } from "@/lib/types";
import { buildPnl, netAfterFee, summarize } from "@/lib/pnl";
import { dateStr, floatStr, imageUrl, listingLink, pct, signClass, signedUsd, usd } from "@/lib/format";

type SurveyState = SurveyResult | { error: string };
type Filter = "all" | "sold" | "holding";

const LS_KEY = "csf_api_key";
const LS_TRADES = "csf_trades_cache";
const LS_SURVEYS = "csf_surveys_cache";
const SURVEY_GAP_MS = 2500; // khoảng nghỉ tối thiểu giữa 2 lần khảo giá

function readLS<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLS(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* bỏ qua nếu storage đầy hoặc bị chặn */
  }
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [trades, setTrades] = useState<NormTrade[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fee, setFee] = useState(2);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tol, setTol] = useState(0.001);
  const [surveys, setSurveys] = useState<Record<string, SurveyState>>({});
  const [surveying, setSurveying] = useState<string | null>(null);
  const lastSurveyAt = useRef(0);

  // Nạp dữ liệu đã lưu trong trình duyệt khi mở trang
  useEffect(() => {
    const k = readLS<string>(LS_KEY);
    if (k) {
      setApiKey(k);
      setKeyInput(k);
    }
    const cached = readLS<{ trades: NormTrade[]; fetchedAt: string }>(LS_TRADES);
    if (cached) {
      setTrades(cached.trades);
      setFetchedAt(cached.fetchedAt);
    }
    const s = readLS<Record<string, SurveyState>>(LS_SURVEYS);
    if (s) setSurveys(s);
  }, []);

  const headers = useCallback((): HeadersInit => (apiKey ? { "x-csfloat-key": apiKey } : {}), [apiKey]);

  const saveKey = () => {
    const k = keyInput.trim();
    setApiKey(k);
    writeLS(LS_KEY, k);
  };

  const clearKey = () => {
    setApiKey("");
    setKeyInput("");
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  };

  const loadTrades = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trades", { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Lỗi ${res.status}`);
      setTrades(data.trades);
      setFetchedAt(data.fetchedAt);
      writeLS(LS_TRADES, { trades: data.trades, fetchedAt: data.fetchedAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được giao dịch.");
    } finally {
      setLoading(false);
    }
  };

  const survey = async (row: PnlRow) => {
    const float = row.item.floatValue;
    if (float == null || surveying) return;
    const wait = lastSurveyAt.current + SURVEY_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setSurveying(row.key);
    try {
      const q = new URLSearchParams({
        name: row.item.marketHashName,
        float: String(float),
        tol: String(tol),
      });
      const res = await fetch(`/api/survey?${q.toString()}`, { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Lỗi ${res.status}`);
      setSurveys((prev) => {
        const next = { ...prev, [row.key]: data as SurveyResult };
        writeLS(LS_SURVEYS, next);
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Khảo giá thất bại.";
      setSurveys((prev) => ({ ...prev, [row.key]: { error: msg } }));
    } finally {
      lastSurveyAt.current = Date.now();
      setSurveying(null);
    }
  };

  const rows = useMemo(() => buildPnl(trades, fee), [trades, fee]);
  const summary = useMemo(() => summarize(rows), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "sold" && r.status === "holding") return false;
      if (filter === "holding" && r.status !== "holding") return false;
      if (q && !r.item.marketHashName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const roi = summary.investedSoldCents > 0 ? (summary.realizedProfitCents / summary.investedSoldCents) * 100 : null;

  return (
    <div className="container">
      <header className="top">
        <div>
          <h1>CSFloat Trader Tool</h1>
          <div className="sub">Lãi/lỗ sau phí {fee}% · khảo giá theo float khi bạn bấm nút</div>
        </div>
        {fetchedAt && <div className="hint">Cập nhật: {new Date(fetchedAt).toLocaleString("vi-VN")}</div>}
      </header>

      <section className="panel">
        <div className="row-inline">
          <input
            className="grow"
            type="password"
            placeholder="Dán CSFloat API key (profile → developer)"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
          />
          <button onClick={saveKey} disabled={!keyInput.trim() || keyInput.trim() === apiKey}>
            Lưu key
          </button>
          {apiKey && (
            <button className="ghost" onClick={clearKey}>
              Xoá key
            </button>
          )}
          <button onClick={loadTrades} disabled={loading}>
            {loading ? "Đang tải…" : trades.length ? "Làm mới giao dịch" : "Tải giao dịch"}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Key được lưu trong trình duyệt của bạn và chỉ gửi qua server của trang này tới CSFloat. Dữ liệu giao dịch được
          lưu tạm trong trình duyệt để không phải tải lại mỗi lần.
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {trades.length > 0 && (
        <>
          <section className="stats">
            <div className="stat">
              <div className="label">Lãi/lỗ đã chốt</div>
              <div className={`value ${signClass(summary.realizedProfitCents)}`}>
                {signedUsd(summary.realizedProfitCents)}
              </div>
              <div className="note">{roi == null ? "—" : `ROI ${pct(roi)}`} · {summary.soldCount} món đã bán</div>
            </div>
            <div className="stat">
              <div className="label">Thắng / Thua</div>
              <div className="value">
                <span className="pos">{summary.winCount}</span> / <span className="neg">{summary.lossCount}</span>
              </div>
              <div className="note">
                {summary.soldCount ? `${((summary.winCount / summary.soldCount) * 100).toFixed(0)}% lệnh có lãi` : "—"}
              </div>
            </div>
            <div className="stat">
              <div className="label">Đang giữ</div>
              <div className="value">{summary.holdingCount}</div>
              <div className="note">Vốn: {usd(summary.holdingCostCents)}</div>
            </div>
            <div className="stat">
              <div className="label">Không rõ giá mua</div>
              <div className="value">{summary.unknownBuyCount}</div>
              <div className="note">Bán nhưng không có lệnh mua tương ứng</div>
            </div>
          </section>

          <div className="toolbar">
            <div className="tabs">
              {(["all", "sold", "holding"] as Filter[]).map((f) => (
                <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                  {f === "all" ? "Tất cả" : f === "sold" ? "Đã bán" : "Đang giữ"}
                </button>
              ))}
            </div>
            <input
              className="grow"
              type="text"
              placeholder="Tìm theo tên…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="hint">
              Phí{" "}
              <input
                className="small"
                type="number"
                min={0}
                max={20}
                step={0.1}
                value={fee}
                onChange={(e) => setFee(Math.max(0, Number(e.target.value) || 0))}
              />{" "}
              %
            </label>
            <label className="hint">
              Float ±{" "}
              <select value={tol} onChange={(e) => setTol(Number(e.target.value))}>
                <option value={0.0002}>0.0002</option>
                <option value={0.0005}>0.0005</option>
                <option value={0.001}>0.001</option>
                <option value={0.005}>0.005</option>
                <option value={0.01}>0.01</option>
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <div className="empty">Không có món nào khớp bộ lọc.</div>
          ) : (
            visible.map((row) => (
              <ItemCard
                key={row.key}
                row={row}
                fee={fee}
                survey={surveys[row.key]}
                busy={surveying === row.key}
                disabled={surveying !== null}
                onSurvey={() => survey(row)}
              />
            ))
          )}
        </>
      )}

      {trades.length === 0 && !loading && !error && (
        <div className="empty">Nhập API key rồi bấm “Tải giao dịch” để bắt đầu.</div>
      )}
    </div>
  );
}

function ItemCard({
  row,
  fee,
  survey,
  busy,
  disabled,
  onSurvey,
}: {
  row: PnlRow;
  fee: number;
  survey: SurveyState | undefined;
  busy: boolean;
  disabled: boolean;
  onSurvey: () => void;
}) {
  const img = imageUrl(row.item.iconUrl);
  const link = listingLink(row.sell?.listingId ?? row.buy?.listingId);
  const badge =
    row.status === "sold" ? (
      <span className="badge sold">Đã bán</span>
    ) : row.status === "holding" ? (
      <span className="badge holding">Đang giữ</span>
    ) : (
      <span className="badge unknown">Không rõ giá mua</span>
    );

  return (
    <div className="item">
      <div className="img">{img ? <img src={img} alt={row.item.marketHashName} loading="lazy" /> : null}</div>
      <div>
        <div className="name">
          {row.item.marketHashName}
          {badge}
        </div>
        <div className="meta">
          Float {floatStr(row.item.floatValue)}
          {row.item.paintSeed != null ? ` · Seed ${row.item.paintSeed}` : ""}
        </div>

        <div className="figures">
          <Fig k={`Giá mua${row.buy ? ` · ${dateStr(row.buy.at)}` : ""}`} v={usd(row.buy?.priceCents)} />
          <Fig k={`Giá bán${row.sell ? ` · ${dateStr(row.sell.at)}` : ""}`} v={usd(row.sell?.priceCents)} />
          {row.sell && <Fig k={`Thực nhận (−${fee}%)`} v={usd(row.netCents)} />}
          {row.status === "sold" && (
            <div className="fig">
              <div className="k">Lãi/lỗ</div>
              <div className={`v ${signClass(row.profitCents)}`}>
                {signedUsd(row.profitCents)} ({pct(row.profitPct)})
              </div>
            </div>
          )}
        </div>

        <div className="actions">
          <button className="small" onClick={onSurvey} disabled={disabled || row.item.floatValue == null}>
            {busy ? "Đang khảo giá…" : survey && !("error" in survey) ? "Khảo giá lại" : "Khảo giá"}
          </button>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer">
              Mở trên CSFloat ↗
            </a>
          )}
        </div>

        {survey && "error" in survey && <div className="error" style={{ marginTop: 10, marginBottom: 0 }}>{survey.error}</div>}
        {survey && !("error" in survey) && <SurveyBox survey={survey} row={row} fee={fee} />}
      </div>
    </div>
  );
}

function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div className="fig">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function SurveyBox({ survey, row, fee }: { survey: SurveyResult; row: PnlRow; fee: number }) {
  if (survey.count === 0) {
    return (
      <div className="survey">
        Không có món nào đang rao với float {survey.floatMin.toFixed(5)} – {survey.floatMax.toFixed(5)}. Thử tăng khoảng
        float.
      </div>
    );
  }
  const holdingCost = row.status === "holding" ? row.buy?.priceCents ?? null : null;
  const estProfit =
    holdingCost != null && survey.medianCents != null
      ? netAfterFee(survey.medianCents, fee) - holdingCost
      : null;

  return (
    <div className="survey">
      <div className="range">
        {usd(survey.minCents)} – {usd(survey.maxCents)}{" "}
        <span className="hint">(trung vị {usd(survey.medianCents)} · {survey.count} listing)</span>
      </div>
      <div className="hint">
        Float {survey.floatMin.toFixed(5)} – {survey.floatMax.toFixed(5)} · khảo lúc{" "}
        {new Date(survey.fetchedAt).toLocaleTimeString("vi-VN")}
      </div>
      {estProfit != null && (
        <div style={{ marginTop: 4 }}>
          Ước tính nếu bán ở giá trung vị (sau phí {fee}%):{" "}
          <span className={signClass(estProfit)}>{signedUsd(estProfit)}</span>
        </div>
      )}
      <ul>
        {survey.closest.map((l) => (
          <li key={l.id}>
            <span>
              Float {floatStr(l.floatValue)}
              {l.floatDiff != null ? ` (Δ ${l.floatDiff.toFixed(5)})` : ""}
            </span>
            <span>
              <strong style={{ color: "var(--text)" }}>{usd(l.priceCents)}</strong>{" "}
              <a href={listingLink(l.id) ?? "#"} target="_blank" rel="noopener noreferrer">
                xem ↗
              </a>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
