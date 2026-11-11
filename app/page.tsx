"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManualSell, NormListing, NormTrade, PnlRow, SurveyResult } from "@/lib/types";
import { buildPnl, itemKeyOf, netAfterFee, summarize } from "@/lib/pnl";
import { findGoneRowKeys, type HoldingInfo, type InvItem } from "@/lib/inventory";
import { dateStr, floatStr, listingLink, searchLink, pct, signClass, signedUsd, usd } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, type Category } from "@/lib/category";
import Inventory from "./Inventory";
import SkinImage from "./SkinImage";
import {
  CsfloatError,
  NetworkError,
  fetchMyListings,
  fetchMySteamId,
  fetchPendingTrades,
  fetchTrades,
  runSurvey,
} from "@/lib/csfloat";
import { SORT_LABELS, sortRows, type SortDir, type SortKey } from "@/lib/sort";

type SurveyState = SurveyResult | { error: string; detail?: ErrorDetail | null };
type Filter = "all" | "sold" | "listed" | "pending" | "holding" | "gone";
const FILTER_LABELS: Record<Filter, string> = {
  all: "Tất cả",
  sold: "Đã bán",
  listed: "Đang bán",
  pending: "Chờ xác nhận",
  holding: "Đang giữ",
  gone: "Không còn trong kho",
};
const LS_INV = "csf_inventory_cache2"; // dùng chung với mục Kho đồ
const LS_KEEP = "csf_keep_overrides"; // dòng bạn xác nhận "vẫn đang giữ"

const LS_KEY = "csf_api_key";
const LS_TRADES = "csf_trades_cache";
const LS_SURVEYS = "csf_surveys_cache";
const LS_MANUAL = "csf_manual_buys"; // giá mua nhập tay (cent) theo khoá của từng dòng
const LS_STEAM_ID = "csf_steam_id";
const LS_CALL_MODE = "csf_call_mode2"; // cách gọi CSFloat: auto | direct | server
const LS_DIRECT_BLOCKED = "csf_direct_blocked"; // trình duyệt từng bị chặn khi gọi trực tiếp (CORS)

type CallMode = "auto" | "direct" | "server";
const CALL_MODE_LABELS: Record<CallMode, string> = {
  server: "Qua server (mặc định)",
  auto: "Thử trình duyệt trước, lỗi thì qua server",
  direct: "Chỉ trình duyệt (thử nghiệm)",
};
const LS_MANUAL_SELL = "csf_manual_sells"; // giá bán nhập tay (bán ở sàn khác) theo khoá của từng dòng
const SURVEY_GAP_MS = 2500; // khoảng nghỉ tối thiểu giữa 2 lần khảo giá
const PART_GAP_MS = 2000; // nghỉ giữa các phần khi tải (lịch sử mua → bán → stall)

type Part = "buyer" | "seller" | "stall" | "pending";
const PART_LABEL: Record<Part, string> = {
  buyer: "lịch sử mua",
  seller: "lịch sử bán",
  stall: "stall (món đang bán)",
  pending: "giao dịch đang chờ xác nhận",
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
  const [pendings, setPendings] = useState<NormTrade[]>([]);
  const [listings, setListings] = useState<NormListing[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partErrors, setPartErrors] = useState<Partial<Record<Part, PartError>>>({});
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const hydrated = useRef(false);
  const trades = useMemo(() => [...buys, ...sells, ...pendings], [buys, sells, pendings]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const [fee, setFee] = useState(2);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"trades" | "inventory">("trades");
  const [callMode, setCallMode] = useState<CallMode>("server");
  const [lastPath, setLastPath] = useState<"direct" | "server" | null>(null);
  const directBlocked = useRef(false);
  const [steamId, setSteamId] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]); // rỗng = tất cả loại
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tol, setTol] = useState(0.001);
  const [surveys, setSurveys] = useState<Record<string, SurveyState>>({});
  const [surveying, setSurveying] = useState<string | null>(null);
  const [manualBuys, setManualBuys] = useState<Record<string, number>>({});
  const [manualSells, setManualSells] = useState<Record<string, ManualSell>>({});
  const lastSurveyAt = useRef(0);
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [keeps, setKeeps] = useState<Record<string, true>>({});

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
      pending?: NormTrade[];
      trades?: NormTrade[]; // định dạng cũ
      listings?: NormListing[];
      fetchedAt?: string | null;
    }>(LS_TRADES);
    if (cached) {
      const all = cached.trades ?? [];
      setBuys(cached.buys ?? all.filter((t) => t.role === "buyer"));
      setSells(cached.sells ?? all.filter((t) => t.role === "seller"));
      setPendings(cached.pending ?? []);
      setListings(cached.listings ?? []);
      setFetchedAt(cached.fetchedAt ?? null);
    }
    const s = readLS<Record<string, SurveyState>>(LS_SURVEYS);
    if (s) setSurveys(s);
    const m = readLS<Record<string, number>>(LS_MANUAL);
    if (m) setManualBuys(m);
    const ms = readLS<Record<string, ManualSell>>(LS_MANUAL_SELL);
    if (ms) setManualSells(ms);
    const inv = readLS<{ items: InvItem[] }>(LS_INV);
    if (inv?.items) setInvItems(inv.items);
    const kp = readLS<Record<string, true>>(LS_KEEP);
    if (kp) setKeeps(kp);
    const sid = readLS<string>(LS_STEAM_ID);
    if (sid) setSteamId(sid);
    const cm = readLS<CallMode>(LS_CALL_MODE);
    if (cm === "auto" || cm === "direct" || cm === "server") setCallMode(cm);
    directBlocked.current = readLS<boolean>(LS_DIRECT_BLOCKED) === true;
  }, []);

  /** Tải kho đồ từ CSFloat để biết món nào thật sự còn giữ. */
  const loadInv = async () => {
    setInvLoading(true);
    setInvError(null);
    try {
      const res = await fetch("/api/inventory", { headers: apiKey ? { "x-csfloat-key": apiKey } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInvError(data?.error ?? `Lỗi ${res.status}`);
        return;
      }
      const list: InvItem[] = data.items ?? [];
      setInvItems(list);
      writeLS(LS_INV, { items: list, fetchedAt: new Date().toISOString() });
    } catch {
      setInvError("Không kết nối được tới server.");
    } finally {
      setInvLoading(false);
    }
  };

  /** Đánh dấu (hoặc bỏ đánh dấu) một dòng là "vẫn đang giữ" dù không thấy trong kho. */
  const setKeep = (key: string, on: boolean) => {
    setKeeps((prev) => {
      const next = { ...prev };
      if (on) next[key] = true;
      else delete next[key];
      writeLS(LS_KEEP, next);
      return next;
    });
  };

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
    writeLS(LS_TRADES, { buys, sells, pending: pendings, listings, fetchedAt });
  }, [buys, sells, pendings, listings, fetchedAt]);
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

  const updateSteamId = (id: string) => {
    setSteamId(id);
    writeLS(LS_STEAM_ID, id);
  };

  const callApi = async (url: string) => {
    const res = await fetch(url, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(data?.error ?? `Lỗi ${res.status}`, res.status, data?.retryAfter ?? null, data?.detail ?? null);
    }
    return data;
  };

  const changeCallMode = (m: CallMode) => {
    setCallMode(m);
    writeLS(LS_CALL_MODE, m);
    if (m !== "server") {
      directBlocked.current = false; // cho thử lại cách gọi trực tiếp
      writeLS(LS_DIRECT_BLOCKED, false);
    }
  };

  /**
   * Gọi CSFloat từ trình duyệt của bạn (IP nhà bạn, không bị tính là nhiều IP như server Vercel);
   * ở chế độ tự động, nếu trình duyệt không gọi được (CORS) thì chuyển sang gọi qua server.
   */
  const viaCsfloat = async <T,>(direct: () => Promise<T>, server: () => Promise<T>): Promise<T> => {
    const canDirect = apiKey !== "" && (callMode === "direct" || (callMode === "auto" && !directBlocked.current));
    if (canDirect) {
      try {
        const r = await direct();
        setLastPath("direct");
        return r;
      } catch (e) {
        if (e instanceof NetworkError) {
          if (callMode === "direct") {
            throw new ApiError(
              "Trình duyệt không gọi trực tiếp được tới CSFloat (nhiều khả năng CSFloat không cho phép gọi từ trang web khác). Hãy chọn chế độ Tự động hoặc chạy ứng dụng trên máy bạn.",
              0,
              null,
            );
          }
          directBlocked.current = true;
          writeLS(LS_DIRECT_BLOCKED, true);
        } else if (e instanceof CsfloatError) {
          throw new ApiError(e.message, e.status, e.retryAfter ?? null, e.detail ?? null);
        } else {
          throw e;
        }
      }
    }
    const r = await server();
    setLastPath("server");
    return r;
  };

  /** Tải từng phần một (không gửi song song), nghỉ giữa các phần. Gặp 429 thì dừng ngay và đếm ngược. */
  const loadParts = async (parts: Part[]) => {
    setLoading(true);
    setError(null);
    let sid = steamId; // Steam ID có thể được cập nhật giữa chừng khi tải stall
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      setProgress(`Đang tải ${PART_LABEL[part]} (${i + 1}/${parts.length})…`);
      try {
        if (part === "stall") {
          const d = await viaCsfloat(
            async () => {
              const id = await fetchMySteamId(apiKey);
              return { listings: await fetchMyListings(apiKey, id), steamId: id };
            },
            () => callApi("/api/stall"),
          );
          setListings(d.listings ?? []);
          if (d.steamId) {
            sid = String(d.steamId);
            updateSteamId(sid);
          }
        } else if (part === "pending") {
          const d = await viaCsfloat(
            async () => ({
              trades: await fetchPendingTrades(apiKey, sid || (await fetchMySteamId(apiKey))),
            }),
            () => callApi(`/api/pending${sid ? `?steamid=${sid}` : ""}`),
          );
          setPendings(d.trades ?? []);
          if (d.steamId && !sid) {
            sid = String(d.steamId);
            updateSteamId(sid);
          }
        } else {
          const d = await viaCsfloat(
            async () => ({ trades: await fetchTrades(apiKey, part) }),
            () => callApi(`/api/trades?role=${part}`),
          );
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
      const data = await viaCsfloat(
        () => runSurvey(apiKey, row.item.marketHashName, float, tol),
        () => callApi(`/api/survey?${q.toString()}`),
      );
      setSurveys((prev) => {
        const next = { ...prev, [row.key]: data as SurveyResult };
        writeLS(LS_SURVEYS, next);
        return next;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setCooldownUntil(Date.now() + (e.retryAfter ?? 60) * 1000);
      }
      let msg = e instanceof Error ? e.message : "Khảo giá thất bại.";
      if (e instanceof ApiError && e.status === 429) {
        msg +=
          " Đợi lâu hơn thường không giúp: CSFloat đang chặn riêng endpoint /listings với IP của server Vercel (các mục khác vẫn dùng được). Cách chắc chắn là chạy ứng dụng trên máy của bạn (npm run dev), khi đó mọi request đi từ một IP nhà bạn.";
      }
      setSurveys((prev) => ({
        ...prev,
        [row.key]: { error: msg, detail: e instanceof ApiError ? e.detail : null },
      }));
    } finally {
      lastSurveyAt.current = Date.now();
      setSurveying(null);
    }
  };

  const rawRows = useMemo(
    () => buildPnl(trades, fee, listings, manualBuys, manualSells),
    [trades, fee, listings, manualBuys, manualSells],
  );
  // "Đang giữ" chỉ đúng khi món còn trong kho: món đã mở/dùng, trade đi hoặc bán nơi khác chuyển sang "Không còn trong kho"
  const rows = useMemo(() => {
    const gone = findGoneRowKeys(rawRows, invItems, itemKeyOf, Date.now());
    if (gone.size === 0) return rawRows;
    return rawRows.map((r) => (gone.has(r.key) && !keeps[r.key] ? { ...r, status: "gone" as const } : r));
  }, [rawRows, invItems, keeps]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const goneStats = useMemo(() => {
    let count = 0;
    let cost = 0;
    for (const r of rows) {
      if (r.status === "gone") {
        count++;
        cost += r.buy?.priceCents ?? 0;
      }
    }
    return { count, cost };
  }, [rows]);

  // Lọc theo trạng thái + tên trước; số lượng từng loại vật phẩm tính trên tập này
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "sold" && r.status !== "sold" && r.status !== "sold_unknown_buy") return false;
      if (filter === "listed" && r.status !== "listed" && r.status !== "listed_unknown_buy") return false;
      if (filter === "pending" && r.status !== "pending_buy" && r.status !== "pending_sell") return false;
      if (filter === "holding" && r.status !== "holding") return false;
      if (filter === "gone" && r.status !== "gone") return false;
      if (q && !r.item.marketHashName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const categoryCounts = useMemo(() => {
    const counts: Record<Category, number> = {
      knife: 0, gloves: 0, rifle: 0, sniper: 0, pistol: 0, smg: 0, shotgun: 0, machinegun: 0, other: 0,
    };
    for (const r of baseFiltered) counts[categoryOf(r.item.marketHashName)]++;
    return counts;
  }, [baseFiltered]);

  const visible = useMemo(() => {
    const byCategory =
      categories.length === 0
        ? baseFiltered
        : baseFiltered.filter((r) => categories.includes(categoryOf(r.item.marketHashName)));
    return sortRows(byCategory, sortKey, sortDir);
  }, [baseFiltered, categories, sortKey, sortDir]);

  const advActive = categories.length + (sortKey !== "default" ? 1 : 0);
  const toggleCategory = (c: Category) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const resetAdv = () => {
    setCategories([]);
    setSortKey("default");
    setSortDir("desc");
  };

  const hasData = trades.length > 0 || listings.length > 0;

  // Các món CSFloat ghi là đang giữ/đang rao/chờ xác nhận (khoá = tên + float + pattern), để đối chiếu với kho đồ
  const holding = useMemo(() => {
    const c: Record<string, HoldingInfo> = {};
    for (const r of rows) {
      if (
        r.status === "holding" ||
        r.status === "gone" ||
        r.status === "listed" ||
        r.status === "listed_unknown_buy" ||
        r.status === "pending_buy"
      ) {
        const k = itemKeyOf(r.item);
        if (c[k]) c[k].count++;
        else c[k] = { name: r.item.marketHashName, floatValue: r.item.floatValue, count: 1 };
      }
    }
    return c;
  }, [rows]);
  const roi = summary.investedSoldCents > 0 ? (summary.realizedProfitCents / summary.investedSoldCents) * 100 : null;

  return (
    <div className="container">
      <header className="top">
        <div>
          <h1>CSFloat Trader</h1>
          <div className="sub">Lãi/lỗ sau phí {fee}%</div>
        </div>
        {fetchedAt && <div className="hint">Cập nhật {new Date(fetchedAt).toLocaleString("vi-VN")}</div>}
      </header>

      <div className="view-tabs">
        <button className={`tab ${view === "trades" ? "active" : ""}`} onClick={() => setView("trades")}>
          Giao dịch
        </button>
        <button className={`tab ${view === "inventory" ? "active" : ""}`} onClick={() => setView("inventory")}>
          Kho đồ
        </button>
      </div>

      {view === "inventory" && (
        <Inventory apiKey={apiKey} holding={holding} hasTrades={hasData} onItems={setInvItems} tol={tol} />
      )}

      {view === "trades" && (
        <>
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
          <button onClick={() => loadParts(["buyer", "seller", "stall", "pending"])} disabled={loading || cooldown > 0}>
            {loading
              ? "Đang tải…"
              : cooldown > 0
                ? `Thử lại sau ${cooldown}s`
                : hasData
                  ? "Làm mới tất cả"
                  : "Tải giao dịch & stall"}
          </button>
          {hasData && (
            <button className="ghost" onClick={() => loadParts(["stall", "pending"])} disabled={loading || cooldown > 0}>
              Chỉ làm mới stall & chờ xác nhận
            </button>
          )}
        </div>
        {progress && (
          <div className="hint" style={{ marginTop: 8 }}>
            {progress}
          </div>
        )}
        <div className="row-inline" style={{ marginTop: 8 }}>
          <label className="hint">
            Cách gọi CSFloat{" "}
            <select value={callMode} onChange={(e) => changeCallMode(e.target.value as CallMode)}>
              {(Object.keys(CALL_MODE_LABELS) as CallMode[]).map((m) => (
                <option key={m} value={m}>
                  {CALL_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {lastPath && (
            <span className="hint">
              Lần gọi gần nhất đi qua: {lastPath === "direct" ? "trình duyệt của bạn" : "server"}
            </span>
          )}
        </div>
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
              <div className="label">Chờ xác nhận</div>
              <div className="value">{summary.pendingBuyCount + summary.pendingSellCount}</div>
              <div className="note">
                Mua {summary.pendingBuyCount} ({usd(summary.pendingBuyCostCents)}) · Bán {summary.pendingSellCount} (nhận{" "}
                {usd(summary.pendingSellNetCents)}, ước tính{" "}
                <span className={signClass(summary.pendingSellEstProfitCents)}>
                  {signedUsd(summary.pendingSellEstProfitCents)}
                </span>
                )
              </div>
            </div>
            <div className="stat">
              <div className="label">Đang giữ</div>
              <div className="value">{summary.holdingCount}</div>
              <div className="note">
                Vốn: {usd(summary.holdingCostCents)}
                {goneStats.count > 0 && ` · ${goneStats.count} món không còn trong kho`}
              </div>
            </div>
            <div className="stat">
              <div className="label">Không rõ giá mua</div>
              <div className="value">{summary.unknownBuyCount}</div>
              <div className="note">Bán nhưng không có lệnh mua tương ứng</div>
            </div>
          </section>

          <div className="toolbar">
            <div className="tabs">
              {(Object.keys(FILTER_LABELS) as Filter[])
                .filter((f) => f !== "gone" || goneStats.count > 0 || filter === "gone")
                .map((f) => (
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
            <button className={`tab ${showAdv || advActive > 0 ? "active" : ""}`} onClick={() => setShowAdv((v) => !v)}>
              Bộ lọc nâng cao{advActive > 0 ? ` (${advActive})` : ""} {showAdv ? "▲" : "▼"}
            </button>
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

          {showAdv && (
            <section className="panel">
              <div className="hint" style={{ marginBottom: 8 }}>
                Loại vật phẩm (chọn nhiều loại; không chọn = tất cả)
              </div>
              <div className="tabs" style={{ flexWrap: "wrap" }}>
                {CATEGORY_ORDER.map((c) => (
                  <button
                    key={c}
                    className={`tab ${categories.includes(c) ? "active" : ""}`}
                    onClick={() => toggleCategory(c)}
                    disabled={categoryCounts[c] === 0 && !categories.includes(c)}
                    style={categoryCounts[c] === 0 && !categories.includes(c) ? { opacity: 0.4, cursor: "default" } : undefined}
                  >
                    {CATEGORY_LABELS[c]} ({categoryCounts[c]})
                  </button>
                ))}
              </div>

              <div className="row-inline" style={{ marginTop: 14 }}>
                <span className="hint">Sắp xếp theo</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <select
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as SortDir)}
                  disabled={sortKey === "default"}
                >
                  <option value="desc">Giảm dần (cao/mới → thấp/cũ)</option>
                  <option value="asc">Tăng dần (thấp/cũ → cao/mới)</option>
                </select>
                <button className="small ghost" onClick={resetAdv} disabled={advActive === 0}>
                  Đặt lại
                </button>
              </div>
              {sortKey !== "default" && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Món không có dữ liệu cho tiêu chí này (ví dụ giá nhập tay không có ngày) luôn nằm cuối danh sách.
                </div>
              )}
            </section>
          )}

          {(filter === "holding" || filter === "gone" || filter === "all") && rawRows.some((r) => r.status === "holding" || r.status === "gone") && (
            <div className="panel" style={{ padding: 10 }}>
              {invItems.length === 0 ? (
                <div className="row-inline">
                  <span className="hint">
                    “Đang giữ” hiện chỉ nghĩa là chưa thấy lệnh bán. Tải kho đồ CSFloat để loại các món đã mở, đã trade hoặc bán nơi khác.
                  </span>
                  <button className="small" onClick={loadInv} disabled={invLoading || !apiKey}>
                    {invLoading ? "Đang tải…" : "Tải kho đồ"}
                  </button>
                </div>
              ) : (
                <div className="row-inline">
                  <span className="hint">
                    Đối chiếu với kho đồ ({invItems.length} món). Món mới mua trong 9 ngày được giữ nguyên vì còn khoá giao dịch.
                  </span>
                  <button className="small ghost" onClick={loadInv} disabled={invLoading || !apiKey}>
                    {invLoading ? "Đang tải…" : "Làm mới kho đồ"}
                  </button>
                </div>
              )}
              {invError && <div className="hint" style={{ color: "var(--red)", marginTop: 6 }}>{invError}</div>}
            </div>
          )}

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
                onKeep={(on) => setKeep(row.key, on)}
                kept={!!keeps[row.key]}
                tol={tol}
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
        </>
      )}
    </div>
  );
}

const WEAR_BANDS = [
  { id: "FN", from: 0, to: 0.07 },
  { id: "MW", from: 0.07, to: 0.15 },
  { id: "FT", from: 0.15, to: 0.38 },
  { id: "WW", from: 0.38, to: 0.45 },
  { id: "BS", from: 0.45, to: 1 },
];

/** Thanh độ mòn: 5 dải FN/MW/FT/WW/BS theo đúng khoảng float, con trỏ chỉ vị trí float của món. */
function WearBar({ float }: { float: number | null }) {
  if (float == null) return null;
  const f = Math.min(1, Math.max(0, float));
  const active = WEAR_BANDS.find((b) => f < b.to) ?? WEAR_BANDS[WEAR_BANDS.length - 1];
  return (
    <div className="wear" title={`Float ${float}`}>
      <div className="wear-track">
        {WEAR_BANDS.map((b) => (
          <span
            key={b.id}
            className={`wear-seg ${b.id === active.id ? "on" : ""}`}
            style={{ width: `${(b.to - b.from) * 100}%` }}
          />
        ))}
        <span className="wear-pin" style={{ left: `${f * 100}%` }} />
      </div>
      <div className="wear-txt">
        <b>{active.id}</b> {floatStr(float)}
      </div>
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
  onKeep,
  kept,
  tol,
  onManual,
  onManualSell,
}: {
  row: PnlRow;
  fee: number;
  survey: SurveyState | undefined;
  busy: boolean;
  disabled: boolean;
  onSurvey: () => void;
  onKeep: (on: boolean) => void;
  kept: boolean;
  tol: number;
  onManual: (cents: number | null) => void;
  onManualSell: (ms: ManualSell | null) => void;
}) {
  const needsManual =
    row.status === "sold_unknown_buy" ||
    row.status === "listed_unknown_buy" ||
    (row.status === "pending_sell" && row.buy == null);
  // Giao dịch đang chờ xác nhận: hiện ngày hết bảo vệ giao dịch nếu CSFloat báo
  const pendingTrade = row.status === "pending_sell" ? row.sell : row.status === "pending_buy" ? row.buy : null;
  const endsAt = pendingTrade?.protectionEndsAt ?? null;
  const endsMs = endsAt ? Date.parse(endsAt) : NaN;
  const daysLeft = Number.isNaN(endsMs) ? null : Math.max(0, Math.ceil((endsMs - Date.now()) / 86400000));
  // Cho phép nhập giá bán ở sàn khác với món đã biết giá mua mà chưa bán trên CSFloat (hoặc đã nhập tay trước đó)
  const canManualSell = ((row.status === "holding" || row.status === "gone" || row.status === "listed") && row.buy != null) || !!row.manualSell;
  const currentManualSell: ManualSell | null =
    row.manualSell && row.sell
      ? { priceCents: row.sell.priceCents, feePct: row.sellFeePct ?? fee, platform: row.sellPlatform ?? null }
      : null;
  const link = listingLink(row.listing?.listingId ?? row.sell?.listingId ?? row.buy?.listingId);
  const badge =
    row.status === "sold" ? (
      <span className="badge sold">Đã bán</span>
    ) : row.status === "listed" ? (
      <span className="badge listed">Đang bán</span>
    ) : row.status === "holding" ? (
      <span className="badge holding">Đang giữ</span>
    ) : row.status === "gone" ? (
      <span className="badge unknown">Không còn trong kho</span>
    ) : row.status === "pending_buy" ? (
      <span className="badge pending">Đang mua · chờ xác nhận</span>
    ) : row.status === "pending_sell" ? (
      <span className="badge pending">Đã bán · chờ xác nhận</span>
    ) : row.status === "listed_unknown_buy" ? (
      <span className="badge listed">Đang bán · không rõ giá mua</span>
    ) : (
      <span className="badge unknown">Không rõ giá mua</span>
    );

  return (
    <div className={`item st-${row.status}`}>
      <div className="img"><SkinImage iconUrl={row.item.iconUrl} alt={row.item.marketHashName} /></div>
      <div>
        <div className="name">
          {row.item.marketHashName}
          {badge}
        </div>
        <div className="meta">
          {row.item.paintSeed != null ? `Seed ${row.item.paintSeed}` : ""}
        </div>
        <WearBar float={row.item.floatValue} />
        {pendingTrade && (
          <div className="meta" style={{ color: "var(--amber)" }}>
            Đang chờ xác nhận
            {endsAt && daysLeft != null
              ? ` · đến ${dateStr(endsAt)}${daysLeft > 0 ? ` (còn ${daysLeft} ngày)` : " (sắp xác nhận)"}`
              : ""}
            {row.status === "pending_sell" ? " · chưa nhận tiền" : ""}
          </div>
        )}

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
              {row.sell && (
                <Fig
                  k={`${row.status === "pending_sell" ? "Dự kiến nhận" : "Thực nhận"} (−${row.sellFeePct ?? fee}%)`}
                  v={usd(row.netCents)}
                />
              )}
              {row.status === "pending_sell" && row.estProfitCents != null && (
                <div className="fig">
                  <div className="k">Lãi/lỗ ước tính</div>
                  <div className={`v ${signClass(row.estProfitCents)}`}>
                    {signedUsd(row.estProfitCents)} ({pct(row.estProfitPct)})
                  </div>
                </div>
              )}
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
          {row.item.floatValue != null && (
            <a
              className="btn small"
              href={searchLink(row.item.marketHashName, row.item.floatValue, tol)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Khảo giá trên CSFloat ↗
            </a>
          )}
          {row.status === "gone" && (
            <button className="small ghost" onClick={() => onKeep(true)} title="Món này vẫn còn, chỉ là chưa hiện trong kho (ví dụ còn khoá giao dịch)">
              Vẫn đang giữ
            </button>
          )}
          {kept && row.status === "holding" && (
            <button className="small ghost" onClick={() => onKeep(false)}>
              Bỏ đánh dấu giữ
            </button>
          )}
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
