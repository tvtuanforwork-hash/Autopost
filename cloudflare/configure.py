"""Generate wrangler.toml from a new D1 database UUID. No secrets stored here."""
from pathlib import Path
import argparse
import re
p = argparse.ArgumentParser()
p.add_argument('--database-id', required=True, help='UUID returned by npx wrangler d1 create autopost_personal')
a = p.parse_args()
if not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', a.database_id):
    p.error('database-id phải là UUID 36 ký tự do Cloudflare cung cấp')
root = Path(__file__).resolve().parent
out = root/'wrangler.toml'
if out.exists():
    p.error('Đã tồn tại wrangler.toml. Không ghi đè để bảo vệ cấu hình hiện có.')
template = (root/'wrangler.template.toml').read_text(encoding='utf-8')
out.write_text(template.replace('REPLACE_WITH_D1_DATABASE_ID', a.database_id), encoding='utf-8')
print('Đã tạo wrangler.toml với D1 ID. Không chứa API Key hoặc mật khẩu.')
