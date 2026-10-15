# AutoPost Personal V1.2 — Chạy CẢ Cloudflare và Enzonic

> **Bản này là Web + API + D1 + Enzonic Python outbound bridge chạy thật. KHÔNG phải AutoPost Zalo/Shopee hoàn chỉnh.** Chưa có đăng nhập Zalo QR thật trên Enzonic, chưa chuyển link Affiliate thật và chưa gửi ảnh/video; không được thử với tài khoản thật cho đến khi module được kiểm thử riêng.

## A. Cloudflare — tạo Web HTTPS và database

**Cần:** tài khoản Cloudflare (có thể dùng tài khoản bạn đã triển khai Workers trước đây), Windows, Node.js LTS và Python 3 để chạy công cụ cấu hình. Không dùng Oracle/Render. Link:

- Cloudflare Dashboard: https://dash.cloudflare.com/
- Node.js: https://nodejs.org/en/download
- D1: https://developers.cloudflare.com/d1/
- Wrangler: https://developers.cloudflare.com/workers/wrangler/

1. Giải nén `AutoPost_Personal_V1_2_Cloudflare_Enzonic.zip` trên máy tính. Vào thư mục `cloudflare`.
2. Mở PowerShell **trong thư mục cloudflare** (gõ `powershell` trên thanh địa chỉ File Explorer) rồi chạy:

   ```powershell
   npm install
   npx wrangler login
   npx wrangler d1 create autopost_personal
   ```

3. Ở kết quả lệnh tạo D1, **copy giá trị UUID của `database_id`** (dạng `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Chạy (thay UUID):

   ```powershell
   python configure.py --database-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

   Lệnh tạo `wrangler.toml` từ template, không phải mở code bằng tay.
4. Chạy migration tạo bảng trên D1 thực:

   ```powershell
   npx wrangler d1 migrations apply autopost_personal --remote
   ```

5. **Deploy lần đầu** (chưa cấu hình mật khẩu nên tất cả đường quản trị vẫn khóa):

   ```powershell
   npx wrangler deploy
   ```

6. Tạo **3 secret mới**, **KHÔNG dùng lại mật khẩu/API Key đã xuất hiện trong ảnh Console Enzonic trước đây**:

   ```powershell
   npx wrangler secret put ADMIN_USER
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put BRIDGE_API_KEY
   ```

   - ADMIN_USER: chẳng hạn `admin`.
   - ADMIN_PASSWORD: chọn một mật khẩu mạnh, mới.
   - BRIDGE_API_KEY: tạo chuỗi ngẫu nhiên bằng `python -c "import secrets; print(secrets.token_urlsafe(36))"` và lưu riêng.
   - Công cụ yêu cầu nhập bí mật; **không đăng chúng lên GitHub, không gửi vào chat, không chụp Console**.

7. Nếu muốn, chạy lại `npx wrangler deploy` sau khi đã thêm đủ secrets. Copy URL **https://...workers.dev** trong kết quả. Mở `/health`: phản hồi JSON có `"ok":true`. Mở URL gốc, đăng nhập bằng **ADMIN_USER** + **ADMIN_PASSWORD** (hộp thoại Basic Auth của trình duyệt).

**Lưu ý:** Không có `wrangler.toml` trong ZIP cho đến bước 3. Không chỉnh `database_id` trong code JS. Nếu command báo không tìm thấy `npm`, hãy cài Node.js rồi mở PowerShell lại. Nếu `wrangler d1 create` đã tự tạo `wrangler.toml`, **không ghi đè cấu hình đó**; kiểm tra binding phải là `DB`, tên DB `autopost_personal` và giữ ID thực mà Cloudflare cấp, rồi bỏ qua lệnh `configure.py`.

## B. Enzonic — chuyển chương trình Python thành bridge gọi Cloudflare

**Server Enzonic cũ của bạn vẫn giữ nguyên. Không xóa database, `.env`, `server/` hay `web/`.** Enzonic KHÔNG phải có HTTPS inbound; phần này chỉ GỌI RA Cloudflare bằng HTTPS.

1. Vào Enzonic → `Files` → `root`.
2. Đổi tên **file `main.py` hiện tại** thành `main_before_cf_v12.py` để sao lưu, không xóa.
3. Upload file **`enzonic/main.py`** từ gói mới vào `root`. Cùng cấp với `requirements.txt`.
4. Mở `enzonic/bridge_config.example.json` **trên máy của bạn**, đổi:
   - `cloudflare_url` thành URL Workers thực ở bước A7 (không thêm `/health`).
   - `bridge_api_key` thành **BRIDGE_API_KEY mới của Cloudflare**.
   - Lưu thành `bridge_config.json`, Upload vào `root`. **Không upload file cấu hình này lên Cloudflare, GitHub hay gửi vào chat.**
5. Vào Enzonic → `Startup` → giữ `Main File = main.py` nếu cho sửa. Với Enzonic này lệnh thực tế ở Console là `python3 main.py`, nên luôn phải có đúng `main.py` mới ở `root`.
6. `Console` → `Restart`. Đợi log:

   ```text
   [AutoPost Bridge] HTTP status port 26220. Outbound API chạy mỗi 30 giây.
   [AutoPost Bridge] Cloudflare OK | enabled rules=0 | sending=False | Zalo=chưa tích hợp
   ```

   Nếu `Cloudflare HTTP 401`, kiểm tra `bridge_config.json` và BRIDGE_API_KEY (không chụp key). Nếu `waiting_config`, kiểm tra file JSON ở root. Nếu không xuất hiện dòng `[AutoPost Bridge]`, Enzonic vẫn chạy `main.py` cũ.
7. Mở Cloudflare Dashboard AutoPost → thẻ **Enzonic Bridge** phải báo Online trong vòng ~60 giây, nhấn Làm mới. Còn Zalo Worker vẫn phải ghi **Chưa tích hợp**. Đó là trạng thái đúng ở V1.2.

## C. Kiểm thử Demo (không dùng Zalo thật)

- Có thể chạy tùy chọn `enzonic/demo_test.py` cùng `main.py` và `bridge_config.json` ở một máy Python đã cấu hình để đưa 2 nhóm DEMO lên Cloudflare; không kết nối tới Zalo.
- Tạo một Rule DEMO trong Web: nó **mặc định TẮT**. Đừng bật để thử gửi khi chưa có Zalo Worker.
- Ping Extension: bạn có thể dùng Chrome extension nằm trong `legacy_v1_1/extension`. Điền URL Cloudflare và API Key **BRIDGE_API_KEY**. Extension cũ chỉ phản hồi Ping; gặp Job đổi link nó trả **unsupported** chứ không tự đổi Shopee.
- Sau khi tắt máy tính cá nhân, Web Cloudflare vẫn hoạt động và Enzonic giữ heartbeat **nếu Enzonic không tạm dừng/thu hồi gói miễn phí**.

## D. Điều kiện chưa đạt / những việc còn phải triển khai

1. Enzonic hiện là container **Python 512 MB**. Zalo Worker V1.1 dùng **Node.js** (`zca-js`) và chưa chạy được trong container Python này: **không thể khẳng định 24/7 nhận/gửi Zalo**. Cần kiểm chứng môi trường Node hoặc nơi chạy Zalo riêng.
2. Shopee Extension cũ V1.1 là Bridge thử nghiệm, không lấy/đưa session thật lên cloud. Không gửi cookie Shopee lên các hệ thống thiếu bảo vệ.
3. Gửi tin Zalo: `ENABLE_ZALO_SENDING=0` trong Wrangler để tránh gửi nhầm. Quy trình xác minh sau 60 giây có API, nhưng chưa có worker gửi/đọc ngược bài thật nên **chưa có `verified` thực tế**. Tin không được tự hủy, không tự gửi trùng nếu trạng thái không rõ.
4. D1 của Cloudflare là dữ liệu mới, không tự chuyển SQLite Enzonic cũ. Chỉ dùng dữ liệu DEMO hoặc đồng bộ các nhóm mới.
5. Mã nguồn `legacy_v1_1/` được giữ nguyên để đối chiếu; **không deploy thư mục này lên Cloudflare**.

## E. Sửa lỗi nhanh

| Triệu chứng | Cách kiểm tra |
|---|---|
| Cloudflare `/health` trả 200, Web hỏi mật khẩu | Đúng, Basic Auth đang hoạt động |
| Cloudflare lỗi 503 `Chưa cấu hình D1` | Kiểm tra `wrangler.toml` binding DB, chạy migration |
| Bảng nhóm trống | Chưa kết nối Zalo; đây là trạng thái thật |
| Enzonic Bridge Offline | Xem Console, `bridge_config.json`, outbound HTTPS và API Key |
| Bridge Online nhưng Zalo Offline | Bình thường ở V1.2, Node worker chưa tích hợp |
| Job đổi link `unsupported` | Bình thường ở V1.2; cần Shopee converter thật |
| Gửi tin không thực hiện | Đang khóa an toàn `ENABLE_ZALO_SENDING=0` |
| Enzonic hết RAM, sleep hoặc tự dừng | Giới hạn gói free; không có bảo đảm 24/7 |

**Quy tắc an toàn:** phiên và thông tin xác thực đã lộ ở chat/Console cũ phải được thay trước khi chạy thật. Không cung cấp API Key, cookie, mật khẩu qua ảnh. Không chạy gửi hàng loạt ngoài các nhóm bạn quản lý hoặc được phép đăng.
