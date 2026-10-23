# CSFloat Trader Tool

Trang web theo dõi các món đồ CS2 bạn đã **mua / bán** trên CSFloat, tính **lãi/lỗ sau phí 2%**, và **khảo giá** các món tương tự đang được rao bán (so sánh theo float gần giống) khi bạn bấm nút.

## Tính năng

- Lấy lịch sử giao dịch đã hoàn tất (`/me/trades`, trạng thái `verified`) của bạn, cả vai trò người mua và người bán.
- Ghép lệnh mua với lệnh bán của cùng một món (tên + float + pattern seed) để tính lãi/lỗ: `thực nhận = giá bán × (1 − phí)`, `lãi/lỗ = thực nhận − giá mua`. Phí mặc định 2%, chỉnh được trên giao diện.
- Phân loại: **Đã bán**, **Đang bán** (đang rao trong stall của bạn), **Đang giữ** (đã mua, chưa rao), **Không rõ giá mua** (bán/đang rao nhưng không thấy lệnh mua).
- Món **Đang bán** hiện giá đang rao và lãi/lỗ ước tính nếu bán được đúng giá đó (sau phí). Stall được lấy bằng `/me` (lấy Steam ID) rồi `/listings?user_id=<steam_id>`; nếu bước này lỗi thì giao dịch vẫn hiển thị kèm thông báo.
- Món **không rõ giá mua** có ô nhập giá mua (USD) ngay trên thẻ. Sau khi lưu, món được tính lãi/lỗ như bình thường (đánh dấu "Giá mua (nhập tay)") và có thể sửa hoặc xoá. Giá nhập tay chỉ lưu trong trình duyệt đang dùng (localStorage), không đồng bộ giữa các thiết bị.
- Hiển thị ảnh món đồ và link mở thẳng trên CSFloat.
- Nút **Khảo giá** trên từng món: gửi đúng 1 request lấy các listing `buy_now` cùng tên với float trong khoảng ± bạn chọn, rồi hiện khoảng giá (thấp nhất / trung vị / cao nhất), 5 listing có float gần nhất kèm link. Không có khảo giá tự động, và có khoảng nghỉ 2,5 giây giữa các lần bấm để tránh bị CSFloat chặn (HTTP 429).
- Dữ liệu giao dịch và kết quả khảo giá được lưu tạm trong trình duyệt (localStorage) để không phải gọi lại API mỗi lần mở trang.

## Công nghệ

Next.js 14 (App Router) + TypeScript. Các route `/api/trades` và `/api/survey` đóng vai trò proxy phía server tới CSFloat (tránh lỗi CORS), nên deploy lên Vercel không cần cấu hình thêm.

## Chạy local

```bash
npm install
npm run dev
```

Mở http://localhost:3000, dán API key (lấy ở CSFloat → Profile → tab **Developer**), bấm **Tải giao dịch**.

Chạy test phần tính lãi/lỗ (cần Node 22.6+):

```bash
npm test
```

## Deploy lên Vercel

1. Vào https://vercel.com/new, import repo `november222/csfloat_trader_tool`.
2. Giữ nguyên cấu hình mặc định (Framework: Next.js) rồi bấm **Deploy**.
3. Mở trang đã deploy và dán API key vào ô nhập.

### Tuỳ chọn: đặt API key ở server

Có thể thêm biến môi trường `CSFLOAT_API_KEY` trong Vercel (Settings → Environment Variables) để không phải nhập key trên giao diện. Khi đó **bất kỳ ai mở được URL của bạn đều xem được giao dịch của bạn**, nên hãy bật *Vercel Authentication* (Settings → Deployment Protection) cho dự án trước.

## Lưu ý

- Docs chính thức của CSFloat không mô tả endpoint `/me/trades` và `/me`; tool dùng endpoint này theo các thư viện cộng đồng. Nếu CSFloat đổi cấu trúc dữ liệu, chỉnh hàm `normTrade` trong `lib/csfloat.ts`.
- Giá của CSFloat tính bằng cent USD.
- Asset ID của món đồ đổi sau mỗi lần trade trên Steam, nên việc ghép mua-bán dựa trên tên + float + pattern seed.
