"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManualSell, NormListing, NormTrade, PnlRow, SurveyResult } from "@/lib/types";
import { buildPnl, netAfterFee, summarize } from "@/lib/pnl";
import { dateStr, floatStr, imageUrl, listingLink, pct, signClass, signedUsd, usd } from "@/lib/format";

type SurveyState = SurveyResult | { error: string };
type Filter = "all" | "sold" | "listed" | "holding";
const FILTER_LABELS: Record<Filter, string> = {
  all: "Tất cả",
  sold: "Đã bán",
  listed: "Đang bán",
  holding: "Đang giữ",
};

const LS_KEY = "csf_api_key";
const LS_TRADES = "csf_trades_cache";
const LS_SURVEYS = "csf_surveys_cache";
const LS_MANUAL = "csf_manual_buys"; // giá mua nhập tay (cent) theo khoá của từng dòng
const LS_MANUAL_SELL = "csf_manual_sells"; // giá bán nhập tay (bán ở sàn khác) theo khoá của từng dòng
const SURVEY_GAP_MS = 2500; // khoảng nghỉ tối thiểu giữa 2 lần khảo giá
const PART_GAP_MS = 2000; // nghỉ giữa các phần khi tải (lịch sử mua → bán → stall)

type Part = "buyer" | "seller" | "stall";
const PART_LABEL: Record<Part, string> = {
  buyer: "lịch sử mua",
  seller: "lịch sử bán",
  stall: "stall (món đang bán)",
};

type ErrorDetail = { endpoint: string; attempts: number; headers: Record<string, string>; body: string };

class ApiError extends Error {
  status: number;
  retryAfter: number | null;
  detail: ErrorDetail | null;
  constructor(message: string, status: number, retryAfter: number | null, detail: ErrorDetail | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

type PartError = { message: string; detail: ErrorDetail | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [buys, setBuys] = useState<NormTrade[]>([]);
  const [sells, setSells] = useState<NormTrade[]>([]);
  const [listings, setListings] = useState<NormListing[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partErrors, setPartErrors] = useState<Partial<Record<Part, PartError>>>({});
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const hydrated = useRef(false);
  const trades = useMemo(() => [...buys, ...sells], [buys, sells]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const [fee, setFee] = useState(2);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tol, setTol] = useState(0.001);
  const [surveys, setSurveys] = useState<Record<string, SurveyState>>({});
  const [surveying, setSurveying] = useState<string | null>(null);
  const [manualBuys, setManualBuys] = useState<Record<string, number>>({});
  const [manualSells, setManualSells] = useState<Record<string, ManualSell>>({});
  const lastSurveyAt = useRef(0);

  // Nạp dữ liệu đã lưu trong trình duyệt khi mở trang
  useEffect(() => {
    const k = readLS<string>(LS_KEY);
    if (k) {
      setApiKey(k);
      setKeyInput(k);
    }
    const cached = readLS<{
      buys?: NormTrade[];
      sells?: NormTrade[];
      trades?: NormTrade[]; // định dạng cũ
      listings?: NormListing[];
      fetchedAt?: string | null;
    }>(LS_TRADES);
    if (cached) {
      const all = cached.trades ?? [];
      setBuys(cached.buys ?? all.filter((t) => t.role === "buyer"));
      setSells(cached.sells ?? all.filter((t) => t.role === "seller"));
      setListings(cached.listings ?? []);
      setFetchedAt(cached.fetchedAt ?? null);
    }
    const s = readLS<Record<string, SurveyState>>(LS_SURVEYS);
    if (s) setSurveys(s);
    const m = readLS<Record<string, number>>(LS_MANUAL);
    if (m) setManualBuys(m);
    const ms = readLS<Record<string, ManualSell>>(LS_MANUAL_SELL);
    if (ms) setManualSells(ms);
  }, []);

  /** Lưu hoặc xoá (ms = null) giá bán nhập tay (bán ở sàn khác) của một dòng. */
  const setManualSell = (key: string, ms: ManualSell | null) => {
    setManualSells((prev) => {
      const next = { ...prev };
      if (ms == null) delete next[key];
      else next[key] = ms;
      writeLS(LS_MANUAL_SELL, next);
      return next;
    });
  };

  // Lưu dữ liệu đã tải vào trình duyệt (bỏ qua lần render đầu, trước khi nạp xong dữ liệu cũ)
  useEffect(() => {
    if (!hydrated.current) return;
    writeLS(LS_TRADES, { buys, sells, listings, fetchedAt });
  }, [buys, sells, listings, fetchedAt]);
  useEffect(() => {
    hydrated.current = true;
  }, []);

  // Đếm ngược khi CSFloat yêu cầu đợi (429)
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  /** Lưu hoặc xoá (cents = null) giá mua nhập tay của một dòng. */
  const setManual = (key: string, cents: number | null) => {
    setManualBuys((prev) => {
      const next = { ...prev };
      if (cents == null) delete next[key];
      else next[key] = cents;
      writeLS(LS_MANUAL, next);
      return next;
    });
  };

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

  const callApi = async (url: string) => {
    const res = await fetch(url, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(data?.error ?? `Lỗi ${res.status}`, res.status, data?.retryAfter ?? null, data?.detail ?? null);
    }
    return data;
  };

  /** Tải từng phần một (không gửi song song), nghỉ giữa các phần. Gặp 429 thì dừng ngay và đếm ngược. */
  const loadParts = async (parts: Part[]) => {
    setLoading(true);
    setError(null);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      setProgress(`Đang tải ${PART_LABEL[part]} (${i + 1}/${parts.length})…`);
      try {
        if (part === "stall") {
          const d = await callApi("/api/stall");
          setListings(d.listings ?? []);
        } else {
          const d = await callApi(`/api/trades?role=${part}`);
          if (part === "buyer") setBuys(d.trades ?? []);
          else setSells(d.trades ?? []);
        }
        setFetchedAt(new Date().toISOString());
        setPartErrors((prev) => ({ ...prev, [part]: undefined }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Tải dữ liệu thất bại.";
        setPartErrors((prev) => ({
          ...prev,
          [part]: { message: msg, detail: e instanceof ApiError ? e.detail : null },
        }));
        if (e instanceof ApiError && e.status === 429) {
          setCooldownUntil(Date.now() + (e.retryAfter ?? 60) * 1000);
          break; // dừng, không gửi thêm request khi đang bị giới hạn
        }
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) break;
      }
      if (i < parts.length - 1) await sleep(PART_GAP_MS);
    }
    setProgress(null);
    setLoading(false);
  };

  const survey = async (row: PnlRow) => {
    const float = row.item.floatValue;
    if (float == null || surveying || cooldown > 0) return;
    const wait = lastSurveyAt.current + SURVEY_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setSurveying(row.key);
    try {
      const q = new URLSearchParams({
        name: row.item.marketHashName,
        float: String(float),
        tol: String(tol),
      });
      const data = await callApi(`/api/survey?${q.toString()}`);
      setSurveys((prev) => {
        const next = { ...prev, [row.key]: data as SurveyResult };
        writeLS(LS_SURVEYS, next);
        return next;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setCooldownUntil(Date.now() + (e.retryAfter ?? 60) * 1000);
      }
      const msg = e instanceof Error ? e.message : "Khảo giá thất bại.";
      setSurveys((prev) => ({ ...prev, [row.key]: { error: msg } }));
    } finally {
      lastSurveyAt.current = Date.now();
      setSurveying(null);
    }
  };

  const rows = useMemo(
    () => buildPnl(trades, fee, listings, manualBuys, manualSells),
    [trades, fee, listings, manualBuys, manualSells],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "sold" && r.status !== "sold" && r.status !== "sold_unknown_buy") return false;
      if (filter === "listed" && r.status !== "listed" && r.status !== "listed_unknown_buy") return false;
      if (filter === "holding" && r.status !== "holding") return false;
      if (q && !r.item.marketHashName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const hasData = trades.length > 0 || listings.length > 0;
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
          <button onClick={() => loadParts(["buyer", "seller", "stall"])} disabled={loading || cooldown > 0}>
            {loading
              ? "Đang tải…"
              : cooldown > 0
                ? `Thử lại sau ${cooldown}s`
                : hasData
                  ? "Làm mới tất cả"
                  : "Tải giao dịch & stall"}
          </button>
          {hasData && (
            <button className="ghost" onClick={() => loadParts(["stall"])} disabled={loading || cooldown > 0}>
              Chỉ làm mới stall
            </button>
          )}
        </div>
        {progress && (
          <div className="hint" style={{ marginTop: 8 }}>
            {progress}
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          Key được lưu trong trình duyệt của bạn và chỉ gửi qua server của trang này tới CSFloat. Dữ liệu đã tải được
          lưu tạm trong trình duyệt nên không cần tải lại mỗi lần mở trang; chỉ làm mới khi cần để tránh bị CSFloat giới
          hạn tốc độ.
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {(Object.keys(PART_LABEL) as Part[]).map((p) =>
        partErrors[p] ? (
          <div className="error" key={p}>
            Không tải được {PART_LABEL[p]}: {partErrors[p]?.message}
            {cooldown > 0 ? ` (tự mở lại nút sau ${cooldown}s)` : ""}
            {hasData ? " Dữ liệu đã tải trước đó vẫn được giữ nguyên." : ""}
            {partErrors[p]?.detail && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer" }}>Chi tiết kỹ thuật (gửi cho người hỗ trợ nếu cần)</summary>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, margin: "6px 0 0" }}>
                  {JSON.stringify(partErrors[p]?.detail, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ) : null,
      )}

      {hasData && (
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
              <div className="label">Đang bán (stall)</div>
              <div className="value">{summary.listedCount}</div>
              <div className="note">
                Rao {usd(summary.listedAskCents)} · ước tính{" "}
                <span className={signClass(summary.listedEstProfitCents)}>
                  {signedUsd(summary.listedEstProfitCents)}
                </span>
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
              {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
                <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                  {FILTER_LABELS[f]}
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
                disabled={surveying !== null || cooldown > 0 || loading}
                onSurvey={() => survey(row)}
                onManual={(cents) => setManual(row.key, cents)}
                onManualSell={(ms) => setManualSell(row.key, ms)}
              />
            ))
          )}
        </>
      )}

      {!hasData && !loading && !error && (
        <div className="empty">Nhập API key rồi bấm “Tải giao dịch & stall” để bắt đầu.</div>
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
  onManual,
  onManualSell,
}: {
  row: PnlRow;
  fee: number;
  survey: SurveyState | undefined;
  busy: boolean;
  disabled: boolean;
  onSurvey: () => void;
  onManual: (cents: number | null) => void;
  onManualSell: (ms: ManualSell | null) => void;
}) {
  const needsManual = row.status === "sold_unknown_buy" || row.status === "listed_unknown_buy";
  // Cho phép nhập giá bán ở sàn khác với món đã biết giá mua mà chưa bán trên CSFloat (hoặc đã nhập tay trước đó)
  const canManualSell = ((row.status === "holding" || row.status === "listed") && row.buy != null) || !!row.manualSell;
  const currentManualSell: ManualSell | null =
    row.manualSell && row.sell
      ? { priceCents: row.sell.priceCents, feePct: row.sellFeePct ?? fee, platform: row.sellPlatform ?? null }
      : null;
  const img = imageUrl(row.item.iconUrl);
  const link = listingLink(row.listing?.listingId ?? row.sell?.listingId ?? row.buy?.listingId);
  const badge =
    row.status === "sold" ? (
      <span className="badge sold">Đã bán</span>
    ) : row.status === "listed" ? (
      <span className="badge listed">Đang bán</span>
    ) : row.status === "holding" ? (
      <span className="badge holding">Đang giữ</span>
    ) : row.status === "listed_unknown_buy" ? (
      <span className="badge listed">Đang bán · không rõ giá mua</span>
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
          <Fig
            k={row.manualBuy ? "Giá mua (nhập tay)" : `Giá mua${row.buy ? ` · ${dateStr(row.buy.at)}` : ""}`}
            v={usd(row.buy?.priceCents)}
          />
          {row.listing ? (
            <>
              <Fig k={`Giá đang rao · ${dateStr(row.listing.at)}`} v={usd(row.listing.priceCents)} />
              <Fig k={`Nếu bán được (−${fee}%)`} v={usd(row.netCents)} />
              {row.estProfitCents != null && (
                <div className="fig">
                  <div className="k">Lãi/lỗ ước tính</div>
                  <div className={`v ${signClass(row.estProfitCents)}`}>
                    {signedUsd(row.estProfitCents)} ({pct(row.estProfitPct)})
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <Fig
                k={
                  row.manualSell
                    ? `Giá bán (nhập tay${row.sellPlatform ? ` · ${row.sellPlatform}` : ""})`
                    : `Giá bán${row.sell ? ` · ${dateStr(row.sell.at)}` : ""}`
                }
                v={usd(row.sell?.priceCents)}
              />
              {row.sell && <Fig k={`Thực nhận (−${row.sellFeePct ?? fee}%)`} v={usd(row.netCents)} />}
            </>
          )}
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

        {(needsManual || row.manualBuy) && (
          <ManualBuyEditor
            current={row.manualBuy ? row.buy?.priceCents ?? null : null}
            onSave={onManual}
          />
        )}

        {canManualSell && <ManualSellEditor current={currentManualSell} defaultFee={fee} onSave={onManualSell} />}

        {survey && "error" in survey && <div className="error" style={{ marginTop: 10, marginBottom: 0 }}>{survey.error}</div>}
        {survey && !("error" in survey) && <SurveyBox survey={survey} row={row} fee={fee} />}
      </div>
    </div>
  );
}

/** Ô nhập giá mua (USD) cho món không có lệnh mua trong lịch sử. Lưu trong trình duyệt. */
function ManualBuyEditor({ current, onSave }: { current: number | null; onSave: (cents: number | null) => void }) {
  const [text, setText] = useState(current != null ? (current / 100).toFixed(2) : "");
  const parsed = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  const save = () => {
    if (valid) onSave(Math.round(parsed * 100));
  };

  return (
    <div className="row-inline" style={{ marginTop: 10 }}>
      <span className="hint">{current != null ? "Sửa giá mua (USD):" : "Nhập giá mua (USD):"}</span>
      <input
        className="small"
        style={{ width: 100 }}
        type="text"
        inputMode="decimal"
        placeholder="0.00"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
      />
      <button className="small" onClick={save} disabled={!valid || (current != null && Math.round(parsed * 100) === current)}>
        Lưu
      </button>
      {current != null && (
        <button
          className="small ghost"
          onClick={() => {
            onSave(null);
            setText("");
          }}
        >
          Xoá
        </button>
      )}
    </div>
  );
}

/** Nhập giá bán cho món mua trên CSFloat nhưng bán ở sàn khác (kèm tên sàn và phí riêng). Lưu trong trình duyệt. */
function ManualSellEditor({
  current,
  defaultFee,
  onSave,
}: {
  current: ManualSell | null;
  defaultFee: number;
  onSave: (ms: ManualSell | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(current ? (current.priceCents / 100).toFixed(2) : "");
  const [platform, setPlatform] = useState(current?.platform ?? "");
  const [feeText, setFeeText] = useState(String(current?.feePct ?? defaultFee));

  const priceNum = Number(price.replace(",", "."));
  const feeNum = Number(feeText.replace(",", "."));
  const valid =
    price.trim() !== "" && Number.isFinite(priceNum) && priceNum > 0 && Number.isFinite(feeNum) && feeNum >= 0 && feeNum < 100;

  if (!current && !open) {
    return (
      <div style={{ marginTop: 10 }}>
        <button className="small ghost" onClick={() => setOpen(true)}>
          Đã bán ở sàn khác?
        </button>
      </div>
    );
  }

  const save = () => {
    if (!valid) return;
    onSave({ priceCents: Math.round(priceNum * 100), feePct: feeNum, platform: platform.trim() || null });
  };

  return (
    <div className="row-inline" style={{ marginTop: 10 }}>
      <span className="hint">Bán ở sàn khác:</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="Giá bán (USD)"
        style={{ width: 120 }}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <input
        type="text"
        placeholder="Tên sàn (tuỳ chọn)"
        style={{ width: 150 }}
        value={platform}
        onChange={(e) => setPlatform(e.target.value)}
      />
      <label className="hint">
        Phí{" "}
        <input
          type="text"
          inputMode="decimal"
          style={{ width: 56 }}
          value={feeText}
          onChange={(e) => setFeeText(e.target.value)}
        />{" "}
        %
      </label>
      <button className="small" onClick={save} disabled={!valid}>
        Lưu
      </button>
      {current ? (
        <button
          className="small ghost"
          onClick={() => {
            onSave(null);
            setPrice("");
            setPlatform("");
            setFeeText(String(defaultFee));
            setOpen(false);
          }}
        >
          Xoá
        </button>
      ) : (
        <button className="small ghost" onClick={() => setOpen(false)}>
          Huỷ
        </button>
      )}
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
  const holdingCost = row.status === "holding" || row.status === "listed" ? row.buy?.priceCents ?? null : null;
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
