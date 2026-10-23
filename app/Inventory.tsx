"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, type Category } from "@/lib/category";
import { classifyInventory, normalizeInventory, parseSteamId, type InvItem, type InvSource } from "@/lib/inventory";
import { imageUrl } from "@/lib/format";

const LS_INV = "csf_inventory_cache";
const PAGE_SIZE = 60;

type SourceFilter = "all" | InvSource;
type InvError = { message: string; detail: unknown; retryAfter: number | null };

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

export default function Inventory({
  steamId,
  onSteamId,
  holdingCounts,
  hasTrades,
}: {
  steamId: string;
  onSteamId: (id: string) => void;
  holdingCounts: Record<string, number>;
  hasTrades: boolean;
}) {
  const [idInput, setIdInput] = useState(steamId);
  const [items, setItems] = useState<InvItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<InvError | null>(null);
  const [src, setSrc] = useState<SourceFilter>("all");
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    const c = readLS<{ items: InvItem[]; fetchedAt: string }>(LS_INV);
    if (c) {
      setItems(c.items);
      setFetchedAt(c.fetchedAt);
    }
  }, []);

  // Khi Steam ID được điền từ nơi khác (vd. lấy từ CSFloat), đồng bộ vào ô nhập nếu ô đang trống
  useEffect(() => {
    if (steamId && !idInput) setIdInput(steamId);
  }, [steamId, idInput]);

  const parsedId = parseSteamId(idInput);

  const store = (list: InvItem[]) => {
    const at = new Date().toISOString();
    setItems(list);
    setFetchedAt(at);
    writeLS(LS_INV, { items: list, fetchedAt: at });
    setShown(PAGE_SIZE);
  };

  const load = async () => {
    if (!parsedId) return;
    onSteamId(parsedId);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory?steamid=${parsedId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.error ?? `Lỗi ${res.status}`, detail: data?.detail ?? null, retryAfter: data?.retryAfter ?? null });
        return;
      }
      store(data.items ?? []);
    } catch {
      setError({ message: "Không kết nối được tới server.", detail: null, retryAfter: null });
    } finally {
      setLoading(false);
    }
  };

  // Phương án dự phòng: tự mở link JSON trong trình duyệt rồi dán vào đây
  const importPasted = () => {
    try {
      const page = normalizeInventory(JSON.parse(pasteText));
      if (!page) {
        setError({ message: "Nội dung dán vào không phải JSON kho đồ Steam hợp lệ.", detail: null, retryAfter: null });
        return;
      }
      setError(null);
      store(page.items);
      setPasteText("");
      setPasteOpen(false);
      if (page.more) {
        setError({
          message: `Kho đồ có nhiều hơn ${page.items.length} món; JSON dán vào chỉ chứa trang đầu. Thêm &start_assetid=${page.lastAssetId} vào link để lấy trang kế tiếp.`,
          detail: null,
          retryAfter: null,
        });
      }
    } catch {
      setError({ message: "Không đọc được JSON. Hãy dán toàn bộ nội dung của trang.", detail: null, retryAfter: null });
    }
  };

  const classified = useMemo(() => classifyInventory(items, holdingCounts), [items, holdingCounts]);

  const counts = useMemo(() => {
    const c = { csfloat: 0, other: 0 };
    for (const it of classified.items) c[it.source]++;
    return c;
  }, [classified]);

  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified.items.filter((it) => {
      if (src !== "all" && it.source !== src) return false;
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

  return (
    <>
      <section className="panel">
        <div className="row-inline">
          <input
            className="grow"
            type="text"
            placeholder="Steam ID (17 chữ số) hoặc link steamcommunity.com/profiles/…"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
          />
          <button onClick={load} disabled={!parsedId || loading}>
            {loading ? "Đang tải kho đồ…" : items.length ? "Làm mới kho đồ" : "Tải kho đồ"}
          </button>
          <button className="ghost" onClick={() => setPasteOpen((v) => !v)}>
            Dán JSON thủ công
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {idInput && !parsedId
            ? "Steam ID chưa hợp lệ. Link dạng /id/tên không dùng được: hãy mở trang Steam của bạn và lấy số 17 chữ số (steamid.io), hoặc tải mục Giao dịch trước để tự điền."
            : "Kho đồ cần để chế độ công khai trong Steam. Không cần đăng nhập hay đưa cookie. Dữ liệu được lưu trong trình duyệt."}
          {fetchedAt && ` · Cập nhật: ${new Date(fetchedAt).toLocaleString("vi-VN")}`}
        </div>

        {pasteOpen && (
          <div style={{ marginTop: 12 }}>
            <div className="hint" style={{ marginBottom: 6 }}>
              Nếu server bị Steam chặn: mở link bên dưới trong trình duyệt (Steam hiện JSON), chọn tất cả, sao chép rồi dán vào ô này.
              {parsedId && (
                <>
                  {" "}
                  <a
                    href={`https://steamcommunity.com/inventory/${parsedId}/730/2?l=english&count=2000`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Mở JSON kho đồ ↗
                  </a>
                </>
              )}
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder='{"assets":[…],"descriptions":[…]}'
              rows={5}
              style={{
                width: "100%", background: "var(--panel-2)", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontSize: 12,
              }}
            />
            <div style={{ marginTop: 8 }}>
              <button className="small" onClick={importPasted} disabled={!pasteText.trim()}>
                Nhập dữ liệu
              </button>
            </div>
          </div>
        )}
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
              <div className="note">Chỉ tính vật phẩm CS2</div>
            </div>
            <div className="stat">
              <div className="label">Khớp CSFloat</div>
              <div className="value">{hasTrades ? counts.csfloat : "—"}</div>
              <div className="note">{hasTrades ? "Đang giữ hoặc đang rao theo lịch sử" : "Tải mục Giao dịch trước để đối chiếu"}</div>
            </div>
            <div className="stat">
              <div className="label">Ngoài CSFloat</div>
              <div className="value">{hasTrades ? counts.other : "—"}</div>
              <div className="note">Không có lệnh mua tương ứng trên CSFloat</div>
            </div>
            <div className="stat">
              <div className="label">Có trong lịch sử, thiếu trong kho</div>
              <div className="value">{hasTrades ? classified.missing.reduce((a, m) => a + m.count, 0) : "—"}</div>
              <div className="note">Có thể đã bán ở nơi khác hoặc đang trong giao dịch</div>
            </div>
          </section>

          {hasTrades && classified.missing.length > 0 && (
            <section className="panel">
              <details>
                <summary style={{ cursor: "pointer" }}>
                  Món CSFloat ghi là đang giữ nhưng không thấy trong kho ({classified.missing.length} loại)
                </summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="hint">
                  {classified.missing.map((m) => (
                    <li key={m.name}>
                      {m.name}
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
                  return (
                    <div className="inv-card" key={it.assetId}>
                      <div className="img">{img ? <img src={img} alt={it.name} loading="lazy" /> : null}</div>
                      <div className="name">{it.name}</div>
                      <div className="meta">
                        <span className={`badge ${it.source === "csfloat" ? "listed" : "unknown"}`} style={{ marginLeft: 0 }}>
                          {it.source === "csfloat" ? "Khớp CSFloat" : "Ngoài CSFloat"}
                        </span>{" "}
                        {it.tradable
                          ? "Giao dịch được"
                          : it.tradableAfter
                            ? `Khoá đến ${new Date(it.tradableAfter).toLocaleDateString("vi-VN")}`
                            : "Không giao dịch được"}
                      </div>
                      <a
                        href={`https://steamcommunity.com/market/listings/730/${encodeURIComponent(it.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="meta"
                      >
                        Xem trên Steam Market ↗
                      </a>
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
        <div className="empty">Nhập Steam ID rồi bấm “Tải kho đồ” để xem vật phẩm trong kho.</div>
      )}
    </>
  );
}
