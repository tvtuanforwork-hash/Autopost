# AutoPost Personal V1.1 — Hướng dẫn đẩy Web + Server + Zalo Worker lên Oracle Cloud

> Mục tiêu: Web/API + SQLite + Zalo QR Worker chạy trên máy chủ 24/7, không phụ thuộc máy cá nhân. Phần đổi link Shopee chưa có adapter thật vì bạn chưa cung cấp extension Shopee. **Không được coi bản này là AutoPost Shopee hoàn thiện.**

## 0. Kiểm tra trước khi cài

- Yêu cầu VPS Linux Ubuntu 22.04 hoặc 24.04, SSH, tên miền trỏ về IP công khai. Ưu tiên thử Oracle Cloud Always Free máy **Ampere A1 ARM64** (cấp phát tùy khu vực), khoảng 2 OCPU/12 GB RAM trong giới hạn free hiện hành. Oracle có thể thiếu tài nguyên hoặc thu hồi máy nhàn rỗi; kiểm tra trước khi chọn.
- Máy chủ phải có port inbound TCP **22** (chỉ IP quản trị của bạn), **80** và **443** trong cả OCI Security List/NSG và firewall Ubuntu. Không mở port 8000 ra Internet.
- Chuẩn bị tên miền `auto.example.com` trỏ bản ghi A tới IPv4 của VPS (có thể dùng DuckDNS nếu bạn có tên miền miễn phí). Caddy tự xin HTTPS khi DNS và ports hoạt động.
- **Zalo connector là thư viện không chính thức** (`zca-js`), có nguy cơ khóa tài khoản. Chỉ dùng trên tài khoản của bạn và nhóm được phép; không tự động vượt CAPTCHA/bảo vệ; khi yêu cầu xác minh hãy xử lý thủ công.
- Không tải `.env`, `data/`, cookie, Session Key, API Key hoặc QR lên GitHub. Không gửi QR/khóa truy cập cho người khác.

## 1. Tạo Oracle Cloud Free VM

1. Truy cập https://www.oracle.com/cloud/free/ tạo tài khoản Oracle Cloud và chọn *Home Region* phù hợp.
2. Oracle Console → Compute → Instances → Create Instance.
3. Chọn Ubuntu 22.04/24.04 **aarch64** và `VM.Standard.A1.Flex` trong giới hạn Always Free. Nếu báo `Out of host capacity`, đổi Availability Domain hoặc thử lại sau. Không tự nâng lên shape có phí.
4. Add SSH public key (`id_ed25519.pub` nếu có). Lưu private key ở máy bạn, không đưa vào Web.
5. Chọn public IPv4, cấu hình mở 80/443 theo bước 0.
6. Kết nối qua terminal hoặc PowerShell: `ssh -i ~/.ssh/id_ed25519 ubuntu@IP_PUBLIC`.

## 2. Cài Docker Engine + Compose (Ubuntu)

Trên VPS Ubuntu, chạy lần lượt các lệnh sau (theo tài liệu Docker chính thức: https://docs.docker.com/engine/install/ubuntu/):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip python3
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
sudo docker run --rm hello-world
```

Để tránh lỗi quyền Docker trên Ubuntu, các lệnh `docker compose` phía dưới có thể chạy dưới dạng `sudo docker compose` (vẫn từ thư mục gốc dự án). Không cần thêm tài khoản Ubuntu vào nhóm `docker` vì nhóm đó có quyền tương đương root.

## 3. Đưa toàn bộ dự án lên server

**Cách dễ:** dùng WinSCP / SFTP hoặc lệnh PowerShell sau tại thư mục chứa ZIP. Thay `IP_PUBLIC` bằng IPv4 của VPS và sửa đường dẫn SSH key cho đúng máy bạn:

```powershell
scp -i "$HOME/.ssh/id_ed25519" .\AutoPost_V1.1_Source.zip ubuntu@IP_PUBLIC:~/
```

Trên VPS:

```bash
sudo apt-get update
sudo apt-get install -y unzip python3
cd ~
unzip AutoPost_V1.1_Source.zip
cd AutoPost_Personal_V1_1_CLOUD_QR
python3 setup.py
chmod 600 .env
```

`setup.py` in ra mật khẩu Web và API Key **một lần**; ghi lại an toàn. Nó tạo khóa mã hóa phiên Zalo; KHÔNG thay đổi khóa này sau khi đã đăng nhập nếu không muốn mất phiên.

### Sửa `.env` và trỏ tên miền

```bash
nano .env
```

Tìm và sửa:

```dotenv
APP_DOMAIN=auto.tenmiencuaban.com
ENABLE_ZALO_EXPERIMENTAL=1
ENABLE_ZALO_SENDING=0
ZALO_SEND_INTERVAL_SECONDS=10
```

**Giữ `ENABLE_ZALO_SENDING=0` khi mới cài**, cho tới khi đã xem đúng QR, đúng danh sách nhóm, đúng rule nguồn/đích. `.env` cũng có `ADMIN_PASSWORD`, `EXTENSION_API_KEY`, `ZALO_VAULT_KEY` được sinh ngẫu nhiên, tuyệt đối không chia sẻ.

## 4. Khởi động tất cả trên Cloud

```bash
# Chạy Web/API/HTTPS trước
sudo docker compose -f deploy/compose.cloud.yml up -d --build

# Khi đã hoàn tất cài đặt, mới khởi chạy Zalo QR worker thử nghiệm
sudo docker compose -f deploy/compose.cloud.yml --profile zalo up -d --build

# Xem dịch vụ
sudo docker compose -f deploy/compose.cloud.yml --profile zalo ps

# Theo dõi đăng nhập Zalo, lỗi kết nối (không in cookie)
sudo docker compose -f deploy/compose.cloud.yml --profile zalo logs --tail=80 -f zalo-worker
```

Nếu không có tên miền: không tắt HTTPS rồi mở API trực tiếp ra Internet. Cần hoàn tất DNS để Caddy xin chứng chỉ trước khi dùng dashboard/extension từ xa.

## 5. Truy cập Web + đăng nhập Zalo QR trên Cloud

1. Mở `https://auto.tenmiencuaban.com` bằng Chrome/Safari, đăng nhập user `admin` và mật khẩu tạo ở `setup.py`.
2. Ở mục **Zalo Cloud**, đợi trạng thái `waiting_qr`. Mã QR được tạo trên SERVER nhưng tải qua Web có xác thực.
3. Mở Zalo trên điện thoại → quét QR → xác nhận đăng nhập nếu chính Zalo hỏi.
4. Nếu phiên hợp lệ, mục Zalo chuyển `active`, Web hiển thị các nhóm đã đồng bộ.
5. Tạo rule nguồn → đích; rule mới mặc định TẮT. Kiểm tra đúng nhóm trước khi bấm **Bật rule**.
6. Để thử gửi tin không chứa link Shopee: đặt bỏ chọn *Chỉ nhận bài có link Shopee*, bật quy tắc cho nhóm kiểm thử thuộc quyền quản lý của bạn; sửa `.env` thành `ENABLE_ZALO_SENDING=1`, áp dụng lệnh `sudo docker compose -f deploy/compose.cloud.yml --profile zalo up -d --force-recreate`.
7. Gửi một tin **văn bản thuần** từ tài khoản khác vào nhóm nguồn. Xem `Hàng đợi Zalo` và nhóm đích thực tế. Nếu có ảnh/video, V1.1 hiện **chưa hỗ trợ lấy/gửi media**.
8. Để tắt gửi ngay, đặt `ENABLE_ZALO_SENDING=0` rồi chạy lại lệnh `--force-recreate`.

**Ghi chú quan trọng:** `zca-js` là API không chính thức mô phỏng Zalo Web, và tài liệu tác giả cảnh báo chỉ một web listener cho mỗi account. Việc bạn mở Zalo Web cùng lúc có thể khiến listener dừng, dù Zalo PC có thể tiếp tục hoạt động.

## 6. Cài extension Shopee bridge (phần có sẵn)

Trên **máy cá nhân** bạn mở `chrome://extensions` → Developer Mode → Load unpacked → chọn thư mục `extension/`.

- Mở popup Extension, nhập `https://auto.tenmiencuaban.com` và `EXTENSION_API_KEY` ở server `.env`.
- Bấm kết nối, Web thấy Extension Online, gửi Job ping để thử.
- **Extension trong gói hiện mới hỗ trợ ping; `convert_links` trả `unsupported` thật.** Do đó các tin chứa link Shopee bị giữ trạng thái `conversion_blocked`, KHÔNG gửi nhầm link gốc.
- Đây là phần cần cập nhật khi bạn gửi extension Shopee dùng để cấp phiên; khi đó phải xây **Cloud Shopee Converter thực tế** độc lập với máy cá nhân để đáp ứng 24/7. API Key bản thân không chuyển cookie/session lên Cloud.

## 7. Chạy liên tục sau khi tắt máy

- `autopost` (FastAPI/SQLite), `caddy` (HTTPS) và `zalo-worker` (Node) chạy bằng Docker `restart: unless-stopped`, không phụ thuộc Web hoặc Chrome máy nhà.
- QR và session Zalo lưu trong thư mục server `data/zalo/`; `session.enc` được mã hóa AES-256-GCM bằng `ZALO_VAULT_KEY` trong `.env`. Có thể phải quét lại QR khi Zalo thu hồi/đổi phiên, và thư viện không bảo đảm session sống vĩnh viễn.
- **Tắt máy vẫn nhận/gửi văn bản không cần đổi Shopee** nếu rule cho phép và worker thực tế đăng nhập thành công. **Tin Shopee vẫn dừng chờ converter server**, chưa phải 24/7 end-to-end.

## 8. Kiểm tra, sao lưu, cập nhật và khắc phục sự cố

```bash
# Trạng thái
sudo docker compose -f deploy/compose.cloud.yml --profile zalo ps
# Logs Cloud API
sudo docker compose -f deploy/compose.cloud.yml --profile zalo logs --tail=150 autopost
# Logs worker
sudo docker compose -f deploy/compose.cloud.yml --profile zalo logs --tail=150 zalo-worker
# Khởi động lại worker
sudo docker compose -f deploy/compose.cloud.yml --profile zalo restart zalo-worker
# Sao lưu dữ liệu và khóa (giữ riêng, mã hóa bản sao lưu)
tar -czf ~/autopost-backup-$(date +%Y%m%d).tar.gz data .env
# Update sau khi thay source: sao lưu trước khi làm
sudo docker compose -f deploy/compose.cloud.yml --profile zalo up -d --build
```

| Triệu chứng | Nguyên nhân thường gặp | Cách kiểm tra/fix |
|---|---|---|
| Không truy cập HTTPS | DNS chưa trỏ IP, NSG/UFW chặn 80/443, Caddy lỗi | `sudo docker compose -f deploy/compose.cloud.yml logs caddy`, kiểm tra `dig auto.tenmien.com` và inbound rules |
| Web trả 502 | Backend chưa chạy | Xem `ps`, `logs autopost`, không mở port 8000 công khai |
| QR không hiện | Chưa bật `--profile zalo`, worker đang thử phục hồi phiên hoặc QR hết hạn | Xem trạng thái/Logs worker, tải lại QR; nếu cần kiểm tra session thất bại |
| Mã QR không quét được | Hết hạn hoặc Zalo yêu cầu xác minh | Chờ QR mới hoặc khởi động lại worker, xác minh chính chủ trên điện thoại |
| Zalo báo Active nhưng không thấy nhóm | Tài khoản không có nhóm hoặc `getGroupInfo` thất bại | `sudo docker compose -f deploy/compose.cloud.yml --profile zalo logs zalo-worker`; gọi lại sync khi kết nối hồi phục |
| Nhận tin nhưng không gửi | Rule đang tắt, `ENABLE_ZALO_SENDING=0`, lọc chỉ Shopee | Kiểm tra rule / `.env`, chỉ bật gửi trong nhóm thử |
| Tin có link Shopee `conversion_blocked` | Chưa tích hợp Shopee Converter thực tế | Chờ cung cấp extension; không đổi link giả/không đăng link gốc |
| `needs_review` | Server không chắc tin đã gửi (timeout/error) | Xem nhóm đích trước khi bấm thử lại, tránh gửi trùng |
| Extension Offline | Chrome trên máy tắt hoặc API Key/sai domain | Extension chỉ chạy khi Chrome trên máy mở; phần Web và worker trên Cloud vẫn chạy |
| Zalo listener bị dừng | Đăng nhập Zalo Web khác hoặc phiên bị giới hạn | Đóng Zalo Web trùng listener; theo dõi Logs; không tìm cách vượt bảo vệ |

## 9. Thông tin không nên hiểu nhầm

- Zapee cho thấy hoạt động 24/7 nhưng **không chứng minh** họ dùng `zca-js` hoặc kỹ thuật nào. V1.1 là bản thử nghiệm riêng.
- Trạng thái `sent` hiện nghĩa là API `sendMessage()` đã chấp nhận lệnh, KHÔNG phải đã nhìn thấy tin ở nhóm đích. Cần kiểm tra thực tế.
- Bản này không nhận/gửi ảnh/video, chưa có phần Shopee Affiliate converter thật, và không có cam kết Zalo login QR sẽ luôn hoạt động trên Oracle Cloud ARM64.
- Tài nguyên Oracle Always Free tùy vùng và chính sách. Xem https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

## Nguồn kỹ thuật

- ZCA-JS và cảnh báo: https://github.com/RFS-ADRENO/zca-js
- Login QR: https://zca-js.tdung.com/vi/auth/login-with-qrcode
- getAllGroups: https://zca-js.tdung.com/vi/apis/getAllGroups
- Caddy HTTPS: https://caddyserver.com/docs/automatic-https
- Docker trên Ubuntu: https://docs.docker.com/engine/install/ubuntu/

## 10. Link trực tiếp và cách biết đang chạy thật

- Oracle Cloud đăng ký Free: https://www.oracle.com/cloud/free/
- Đăng nhập Cloud Console: https://cloud.oracle.com/
- Tạo tên miền phụ miễn phí (tùy nhu cầu): https://www.duckdns.org/
- Hướng dẫn cài Docker chính thức: https://docs.docker.com/engine/install/ubuntu/

**Phân biệt kết quả:** sau khi cài, Web có thể mở qua HTTPS và worker có thể chạy trên VPS ngay cả khi tắt máy cá nhân. Nhưng chỉ khi quét QR Zalo thực tế thành công, nhận được tin mới và gửi thử đến nhóm thì mới coi phần Zalo chạy. Phần Shopee đổi link và kiểm tra bài không biến mất sau 60 giây **chưa có ở V1.1**, cần tích hợp và kiểm thử thêm. Đừng bật gửi vào nhóm thật trước khi thử nhóm riêng.
