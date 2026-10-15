"""One-time local setup. Never share the generated .env file."""
from pathlib import Path
from secrets import token_urlsafe, token_hex

root = Path(__file__).resolve().parent
env_path = root / '.env'
if env_path.exists():
    raise SystemExit('.env đã tồn tại. Không tự ghi đè khóa hiện tại.')
admin = token_urlsafe(24)
key = token_urlsafe(32)
env_path.write_text(f'ADMIN_USER=admin\nADMIN_PASSWORD={admin}\nEXTENSION_API_KEY={key}\nAPP_DB_PATH=data/autopost.sqlite3\nAPP_DOMAIN=CHANGE_ME.example.com\nENABLE_ZALO_EXPERIMENTAL=0\nENABLE_ZALO_SENDING=0\nZALO_SEND_INTERVAL_SECONDS=10\nZALO_VAULT_KEY={token_hex(32)}\n', encoding='utf-8')
try:
    env_path.chmod(0o600)
except OSError:
    pass
print('Tạo .env thành công. Giữ bí mật thông tin này.')
print('Tài khoản Web: admin')
print('Mật khẩu Web:', admin)
print('Extension API Key:', key)
print('Không đăng .env lên GitHub. Không chia sẻ API Key hoặc mật khẩu.')
