# AutoPost Personal V1.1 CLOUD / QR (source)

Bản này **nâng từ bản V1 có sẵn**, không sửa quy trình ping hoặc extension bridge đang chạy. Các module tách riêng: `server/forwarding.py`, `zalo-worker/`, `deploy/compose.cloud.yml`. Xem hướng dẫn tiếng Việt đầy đủ: **[HUONG_DAN_CLOUD_ORACLE.md](HUONG_DAN_CLOUD_ORACLE.md)**.

## Trạng thái

| Module | Trạng thái |
|---|---|
| Web Dashboard / Auth / Ping API Key / SQLite jobs | Có code và tests; dựa V1 |
| Oracle Cloud (Compose + Caddy HTTPS) | Có cấu hình để người dùng triển khai, chưa triển khai lên tài khoản của bạn |
| Zalo QR / listener / nhóm / gửi text | Code connector **thử nghiệm** dùng zca-js không chính thức; cần test trực tiếp bằng Zalo thật sau khi deploy |
| Forwarding Rules / dedupe / giữ tin có Shopee link | Có code, có tests API |
| Shopee Affiliate Converter 24/7 | **Chưa có**, đang chờ extension thật; không tạo link giả |
| Media ảnh/video và xác minh tin xuất hiện | **Chưa có**, chỉ text; không báo gửi thành công giả |

### Tóm tắt khởi chạy Web cục bộ

```bash
python3 -m pip install -r requirements.txt
python3 setup.py
python3 -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

Mở http://127.0.0.1:8000, user admin và mật khẩu từ setup.py. Bản Cloud cần **hostname và HTTPS**, đọc `HUONG_DAN_CLOUD_ORACLE.md`.

### Bảo vệ khỏi gửi nhầm

- `ENABLE_ZALO_SENDING=0` là mặc định. Rule mới cũng `enabled=false`.
- Tin chứa Shopee link bắt buộc nhận đầy đủ link Affiliate từ converter. Nếu converter chưa tích hợp, `conversion_blocked`.
- Job trùng `(source_group,message_id)` không tạo bài mới.
- Một delivery chỉ có một lease; nếu không xác nhận được việc gửi, chuyển `needs_review` thay vì retry tự động.
- Session QR được mã hóa tại server bằng khóa riêng; QR tải qua trang phải đăng nhập.

**Lưu ý:** Repo `zca-js` mô phỏng phiên Web và tác giả cảnh báo có rủi ro bị khóa tài khoản. Không mặc định nó hoạt động giống Zapee.
