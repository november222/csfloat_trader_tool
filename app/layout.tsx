import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSFloat Trader Tool",
  description: "Theo dõi lãi/lỗ giao dịch CSFloat và khảo giá món đồ tương tự theo float.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
