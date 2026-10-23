# CSFloat Trader Tool

Trang web theo dõi các món đồ CS2 bạn đã **mua / bán** trên CSFloat, tính **lãi/lỗ sau phí 2%**, và **khảo giá** các món tương tự đang được rao bán (so sánh theo float gần giống) khi bạn bấm nút.

## Tính năng

- Lấy lịch sử giao dịch đã hoàn tất (`/me/trades`, trạng thái `verified`) của bạn, cả vai trò người mua và người bán.
- Ghép lệnh mua với lệnh bán của cùng một món (tên + float + pattern seed) để tính lãi/lỗ: `thực nhận = giá bán × (1 − phí)`, `lãi/lỗ = thực nhận − giá mua`. Phí mặc định 2%, chỉnh được trên giao diện.
- Phân loại: **Đã bán**, **Đang bán** (đang rao trong stall của bạn), **Đang giữ** (đã mua, chưa rao), **Không rõ giá mua** (bán/đang rao nhưng không thấy lệnh mua).
- Món **Đang bán** hiện giá đang rao và lãi/lỗ ước tính nếu bán được đúng giá đó (sau phí). Stall được lấy bằng `/me` (lấy Steam ID) rồi `/listings?user_id=<steam_id>`; nếu bước này lỗi thì giao dịch vẫn hiển thị kèm thông báo.
- Món **không rõ giá mua** có ô nhập giá mua (USD) ngay trên thẻ. Sau khi lưu, món được tính lãi/lỗ như bình thường (đánh dấu "Giá mua (nhập tay)") và có thể sửa hoặc xoá. Giá nhập tay chỉ lưu trong trình duyệt đang dùng (localStorage), không đồng bộ giữa các thiết bị.
- Món mua trên CSFloat nhưng **bán ở sàn khác**: bấm "Đã bán ở sàn khác?" trên thẻ (món đang giữ hoặc đang rao), nhập giá bán (USD), tên sàn (tuỳ chọn) và phí riêng của sàn đó (mặc định bằng phí đang chọn). Món được chuyển sang "Đã bán", tính vào lãi/lỗ đã chốt với nhãn "Giá bán (nhập tay · tên sàn)"; có thể sửa hoặc xoá. Lưu trong trình duyệt (localStorage).
- **Bộ lọc nâng cao** (nút trên thanh công cụ): lọc theo loại vật phẩm (Dao, Găng tay, Súng trường, Súng ngắm, Súng lục, Tiểu liên, Shotgun, Súng máy, Khác; chọn được nhiều loại, mỗi loại hiện số lượng) và sắp xếp theo giá mua, giá bán/giá đang rao, lãi/lỗ, ngày mua, ngày bán (tăng hoặc giảm dần). Món không có dữ liệu cho tiêu chí đang sắp xếp (ví dụ giá nhập tay không có ngày) luôn nằm cuối. Loại vật phẩm được suy ra từ tên món nên không tốn thêm request.
- Mục **Kho đồ**: nhập Steam ID (17 chữ số hoặc link `steamcommunity.com/profiles/…`) để xem vật phẩm CS2 trong kho (kho đồ phải để công khai; không cần đăng nhập hay cookie). Mỗi món được đối chiếu theo tên với các món CSFloat ghi là đang giữ/đang rao: **Khớp CSFloat** hoặc **Ngoài CSFloat** (mua ở nơi khác, mở hòm, nhận được...), kèm danh sách món CSFloat ghi là đang giữ nhưng không thấy trong kho. Có lọc theo nguồn, loại vật phẩm, tìm tên, trạng thái giao dịch/khoá. Steam ID tự điền sau khi tải mục Giao dịch. Nếu Steam chặn server (429/403), dùng nút **Dán JSON thủ công**: mở link JSON trong trình duyệt của bạn rồi dán vào.
- **Chờ xác nhận** (giao dịch `pending`, thời gian bảo vệ giao dịch ~8 ngày, giống mục Profile → Trades trên CSFloat): món **đang mua · chờ xác nhận** tính vào vốn đang chờ; món **đã bán · chờ xác nhận** hiện số tiền dự kiến nhận và lãi/lỗ ước tính, chưa tính vào lãi/lỗ đã chốt cho đến khi giao dịch được xác nhận (lúc đó tự chuyển sang Đã bán). Thẻ hiện ngày hết bảo vệ và số ngày còn lại nếu CSFloat báo. Vai trò mua/bán được xác định bằng cách so `buyer_id` với Steam ID của bạn. Giao dịch bị huỷ (Cancelled) không được tính.
- Hiển thị ảnh món đồ và link mở thẳng trên CSFloat.
- Nút **Khảo giá** trên từng món: gửi đúng 1 request lấy các listing `buy_now` cùng tên với float trong khoảng ± bạn chọn, rồi hiện khoảng giá (thấp nhất / trung vị / cao nhất), 5 listing có float gần nhất kèm link. Không có khảo giá tự động, và có khoảng nghỉ 2,5 giây giữa các lần bấm để tránh bị CSFloat chặn (HTTP 429).
- Dữ liệu giao dịch và kết quả khảo giá được lưu tạm trong trình duyệt (localStorage) để không phải gọi lại API mỗi lần mở trang.

## Công nghệ

Next.js 14 (App Router) + TypeScript. Các route `/api/trades`, `/api/stall` và `/api/survey` đóng vai trò proxy phía server tới CSFloat (tránh lỗi CORS), nên deploy lên Vercel không cần cấu hình thêm.

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
- Chống lỗi 429 (giới hạn tốc độ): trình duyệt tải từng phần một (lịch sử mua → lịch sử bán → stall), nghỉ vài giây giữa các phần; server nghỉ 1,5 giây giữa các trang và tự thử lại vài lần nếu CSFloat bảo đợi ngắn. Nếu vẫn bị 429, trang dừng ngay, giữ nguyên dữ liệu đã tải và đếm ngược trước khi cho bấm lại. Có nút "Chỉ làm mới stall" để không phải tải lại toàn bộ lịch sử.
- Khi CSFloat trả lỗi (429, 401/403...), trang hiện thêm mục **Chi tiết kỹ thuật** (endpoint nào, header giới hạn tốc độ, đoạn đầu nội dung phản hồi; không chứa API key) để biết lỗi đến từ API hay từ lớp chống bot.
- Phân trang có chốt chặn: dừng ngay nếu một trang không có dữ liệu mới, và stall chỉ nhận listing có người bán đúng là bạn.
- Kho đồ lấy từ endpoint cộng đồng của Steam (không phải Web API chính thức) nên có thể bị giới hạn theo IP; kho đồ Steam không có float, pattern seed hay giá, và đối chiếu với CSFloat chỉ dựa trên tên món (asset ID đổi sau mỗi lần trade).
- **Lỗi 429 "too many requests from too many IPs"**: server Vercel không có IP cố định, nên CSFloat thấy cùng một API key đến từ nhiều IP và chặn. Vì vậy trang có mục **Cách gọi CSFloat**: *Tự động* (mặc định) gọi CSFloat thẳng từ trình duyệt của bạn (IP nhà bạn) và chỉ chuyển sang gọi qua server nếu trình duyệt bị chặn (CORS); *Chỉ trình duyệt* và *Chỉ qua server* để chọn cố định. Cách chắc chắn nhất nếu vẫn bị chặn: chạy ứng dụng trên máy bạn (`npm run dev`). Kho đồ Steam không gọi trực tiếp từ trình duyệt được (Steam không cho gọi chéo tên miền), dùng nút Dán JSON thủ công.
- Stall (món đang bán) được lấy bằng endpoint riêng `/users/<steam_id>/stall` (phân trang bằng cursor), vì endpoint `/listings` bị CSFloat giới hạn chặt hơn với server dùng chung IP; nếu endpoint stall không dùng được thì quay về `/listings?user_id=`. Nút **Khảo giá** vẫn dùng `/listings` nên có thể bị chặn từ Vercel; khi đó hãy chạy ứng dụng trên máy bạn.
- Gọi CSFloat trực tiếp từ trình duyệt đã được thử và bị CSFloat từ chối (CORS), nên chế độ mặc định là qua server.
- Giá của CSFloat tính bằng cent USD.
- Asset ID của món đồ đổi sau mỗi lần trade trên Steam, nên việc ghép mua-bán dựa trên tên + float + pattern seed.
