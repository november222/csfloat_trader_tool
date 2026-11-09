import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSFloat Trader Tool",
  description: "Theo dõi lãi/lỗ giao dịch CSFloat và khảo giá món đồ tương tự theo float.",
};

// Khoá zoom: tránh trình duyệt điện thoại tự phóng to khi bấm nút / chạm đúp
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
