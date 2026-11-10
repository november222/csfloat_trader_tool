"use client";

import { useState } from "react";
import { imageCandidates } from "@/lib/format";

/** Ảnh món đồ: thử lần lượt vài máy chủ ảnh Steam, hỏng hết thì hiện ô thay thế thay vì biểu tượng ảnh lỗi. */
export default function SkinImage({ iconUrl, alt }: { iconUrl: string | null | undefined; alt: string }) {
  const urls = imageCandidates(iconUrl);
  const [i, setI] = useState(0);
  if (i >= urls.length) {
    return (
      <span className="img-fallback" role="img" aria-label={alt}>
        {alt.replace(/^★\s*/, "").trim().charAt(0) || "?"}
      </span>
    );
  }
  return (
    <img
      key={urls[i]}
      src={urls[i]}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setI((n) => n + 1)}
    />
  );
}
