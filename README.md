# AutoPost Personal V1.2 — Cloudflare + Enzonic

**Trạng thái:** Có Web/API Cloudflare Workers, D1 durable queue, dashboard, quy tắc nhóm, Extension Bridge compatibility và Enzonic Python outbound heartbeat. Không bao gồm Zalo client thật, Shopee conversion thật, ảnh/video hay chứng thực giữ tin 60 giây trên Zalo.

## Xem hướng dẫn từng bước

`docs/HUONG_DAN_CLOUDFLARE_ENZONIC.md`

## Cấu trúc

- `cloudflare/` Web/Worker JS + D1, chạy trên Cloudflare Free.
- `enzonic/` File `main.py` (Python chuẩn, không cần pip) và `bridge_config.example.json`.
- `legacy_v1_1/` Nguyên bộ mã nguồn cũ được giữ nguyên để tránh mất chức năng đã có, KHÔNG deploy lên Workers.
- `docs/` Hướng dẫn cài cả hai nền tảng.

## Chỉ thay đúng các phần yêu cầu

Cloudflare chỉ cần thư mục `cloudflare/`; Enzonic chỉ cần file `enzonic/main.py` và `bridge_config.json` được tạo từ mẫu, không xóa database cũ. Không còn dùng địa chỉ Enzonic TCP port 26220 làm Web HTTPS.

## Kiểm thử đã chạy cục bộ

`node --check` cho code JS, `node --test` kiểm tra logic lọc link/thiếu converter và API auth/health, `python -m py_compile` cho bridge Python, `sqlite3` xác nhận schema migration. Chưa có triển khai thật lên tài khoản Cloudflare/Enzonic của người dùng và chưa thể kiểm thử Zalo QR.
