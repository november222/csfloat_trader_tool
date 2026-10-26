"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, type Category } from "@/lib/category";
import { classifyInventory, type HoldingInfo, type InvItem, type InvSource } from "@/lib/inventory";
import { itemKeyOf } from "@/lib/pnl";
import { floatStr, imageUrl, listingLink } from "@/lib/format";

const LS_INV = "csf_inventory_cache2"; // dữ liệu kho đồ lấy từ CSFloat
const PAGE_SIZE = 60;

type SourceFilter = "all" | InvSource | "listed";
type InvError = { message: string; detail: unknown };

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

const keyOfInv = (it: InvItem) =>
  itemKeyOf({ marketHashName: it.name, floatValue: it.floatValue, paintSeed: it.paintSeed });

export default function Inventory({
  apiKey,
  holding,
  hasTrades,
}: {
  apiKey: string;
  holding: Record<string, HoldingInfo>;
  hasTrades: boolean;
}) {
  const [items, setItems] = useState<InvItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<InvError | null>(null);
  const [src, setSrc] = useState<SourceFilter>("all");
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);

  useEffect(() => {
    const c = readLS<{ items: InvItem[]; fetchedAt: string }>(LS_INV);
    if (c) {
      setItems(c.items);
      setFetchedAt(c.fetchedAt);
    }
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory", { headers: apiKey ? { "x-csfloat-key": apiKey } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.error ?? `Lỗi ${res.status}`, detail: data?.detail ?? null });
        return;
      }
      const list: InvItem[] = data.items ?? [];
      const at = new Date().toISOString();
      setItems(list);
      setFetchedAt(at);
      setShown(PAGE_SIZE);
      writeLS(LS_INV, { items: list, fetchedAt: at });
    } catch {
      setError({ message: "Không kết nối được tới server.", detail: null });
    } finally {
      setLoading(false);
    }
  };

  const classified = useMemo(() => classifyInventory(items, holding, keyOfInv), [items, holding]);

  const counts = useMemo(() => {
    const c = { csfloat: 0, other: 0, listed: 0 };
    for (const it of classified.items) {
      c[it.source]++;
      if (it.listingId) c.listed++;
    }
    return c;
  }, [classified]);

  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified.items.filter((it) => {
      if (src === "listed" ? !it.listingId : src !== "all" && it.source !== src) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [classified, src, query]);

  const categoryCounts = useMemo(() => {
    const c: Record<Category, number> = {
      knife: 0, gloves: 0, rifle: 0, sniper: 0, pistol: 0, smg: 0, shotgun: 0, machinegun: 0, other: 0,
    };
    for (const it of base) c[categoryOf(it.name)]++;
    return c;
  }, [base]);

  const visible = useMemo(
    () => (category === "all" ? base : base.filter((it) => categoryOf(it.name) === category)),
    [base, category],
  );

  const missingTotal = classified.missing.reduce((a, m) => a + m.count, 0);

  return (
    <>
      <section className="panel">
        <div className="row-inline">
          <button onClick={load} disabled={loading}>
            {loading ? "Đang tải kho đồ…" : items.length ? "Làm mới kho đồ" : "Tải kho đồ"}
          </button>
          {fetchedAt && <span className="hint">Cập nhật: {new Date(fetchedAt).toLocaleString("vi-VN")}</span>}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Kho đồ lấy trực tiếp từ CSFloat bằng API key của bạn (gồm float và pattern seed), không cần Steam ID và không
          phụ thuộc chế độ riêng tư của kho Steam. CSFloat chỉ trả về món có thể giao dịch, nên món còn trong thời gian
          khoá giao dịch có thể chưa hiện. Dữ liệu được lưu trong trình duyệt.
        </div>
      </section>

      {error && (
        <div className="error">
          {error.message}
          {error.detail != null && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer" }}>Chi tiết kỹ thuật</summary>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, margin: "6px 0 0" }}>
                {JSON.stringify(error.detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {items.length > 0 && (
        <>
          <section className="stats">
            <div className="stat">
              <div className="label">Tổng trong kho</div>
              <div className="value">{items.length}</div>
              <div className="note">Đang rao trên CSFloat: {counts.listed}</div>
            </div>
            <div className="stat">
              <div className="label">Khớp CSFloat</div>
              <div className="value">{hasTrades ? counts.csfloat : "—"}</div>
              <div className="note">
                {hasTrades ? "Khớp theo tên + float + pattern với lịch sử mua" : "Tải mục Giao dịch trước để đối chiếu"}
              </div>
            </div>
            <div className="stat">
              <div className="label">Ngoài CSFloat</div>
              <div className="value">{hasTrades ? counts.other : "—"}</div>
              <div className="note">Không có lệnh mua tương ứng trên CSFloat</div>
            </div>
            <div className="stat">
              <div className="label">Có trong lịch sử, thiếu trong kho</div>
              <div className="value">{hasTrades ? missingTotal : "—"}</div>
              <div className="note">Đã bán nơi khác, hoặc còn khoá giao dịch</div>
            </div>
          </section>

          {hasTrades && classified.missing.length > 0 && (
            <section className="panel">
              <details>
                <summary style={{ cursor: "pointer" }}>
                  Món CSFloat ghi là đang giữ nhưng không thấy trong kho ({classified.missing.length} món)
                </summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="hint">
                  {classified.missing.map((m, i) => (
                    <li key={`${m.name}-${m.floatValue}-${i}`}>
                      {m.name}
                      {m.floatValue != null ? ` · float ${floatStr(m.floatValue)}` : ""}
                      {m.count > 1 ? ` × ${m.count}` : ""}
                    </li>
                  ))}
                </ul>
                <div className="hint" style={{ marginTop: 8 }}>
                  Nếu đã bán những món này ở sàn khác, vào mục Giao dịch và dùng nút “Đã bán ở sàn khác?” trên món tương ứng.
                </div>
              </details>
            </section>
          )}

          <div className="toolbar">
            <div className="tabs">
              {(
                [
                  ["all", "Tất cả"],
                  ["other", "Ngoài CSFloat"],
                  ["csfloat", "Khớp CSFloat"],
                  ["listed", "Đang rao"],
                ] as [SourceFilter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`tab ${src === k ? "active" : ""}`}
                  onClick={() => {
                    setSrc(k);
                    setShown(PAGE_SIZE);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="grow"
              type="text"
              placeholder="Tìm theo tên…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE_SIZE);
              }}
            />
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as Category | "all");
                setShown(PAGE_SIZE);
              }}
            >
              <option value="all">Mọi loại ({base.length})</option>
              {CATEGORY_ORDER.filter((c) => categoryCounts[c] > 0).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]} ({categoryCounts[c]})
                </option>
              ))}
            </select>
          </div>

          {visible.length === 0 ? (
            <div className="empty">Không có món nào khớp bộ lọc.</div>
          ) : (
            <>
              <div className="inv-grid">
                {visible.slice(0, shown).map((it) => {
                  const img = imageUrl(it.iconUrl);
                  const link = listingLink(it.listingId);
                  return (
                    <div className="inv-card" key={it.assetId}>
                      <div className="img">{img ? <img src={img} alt={it.name} loading="lazy" /> : null}</div>
                      <div className="name">{it.name}</div>
                      <div className="meta">
                        {it.floatValue != null ? `Float ${floatStr(it.floatValue)}` : "Không có float"}
                        {it.paintSeed != null ? ` · Seed ${it.paintSeed}` : ""}
                      </div>
                      <div className="meta">
                        <span className={`badge ${it.source === "csfloat" ? "listed" : "unknown"}`} style={{ marginLeft: 0 }}>
                          {it.source === "csfloat" ? "Khớp CSFloat" : "Ngoài CSFloat"}
                        </span>
                        {it.listingId && (
                          <span className="badge sold" style={{ marginLeft: 6 }}>
                            Đang rao
                          </span>
                        )}
                      </div>
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="meta">
                          Mở listing trên CSFloat ↗
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
              {visible.length > shown && (
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <button className="ghost" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Hiện thêm ({visible.length - shown} món)
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {items.length === 0 && !loading && !error && (
        <div className="empty">Bấm “Tải kho đồ” để xem vật phẩm trong kho CSFloat của bạn.</div>
      )}
    </>
  );
}
