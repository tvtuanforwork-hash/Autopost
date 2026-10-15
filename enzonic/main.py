"""AutoPost Personal 1.2: Enzonic Python-only outbound bridge.

Does not claim to implement Zalo QR/Shopee conversion. No inbound access required.
The internal HTTP listener is only for Enzonic process health, not for Web management.
"""
import json
import os
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'bridge_config.json'
CURRENT = {'state': 'starting', 'last_cloudflare': None, 'message': 'Bridge đang khởi động'}


def load_config():
    if not CONFIG.is_file():
        return None, 'Thiếu bridge_config.json, chưa cấu hình Cloudflare'
    try:
        c = json.loads(CONFIG.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None, 'bridge_config.json không phải JSON hợp lệ'
    server = str(c.get('cloudflare_url', '')).rstrip('/')
    key = str(c.get('bridge_api_key', '')).strip()
    try:
        u = urlparse(server)
        valid = u.scheme == 'https' and u.hostname and not u.username and not u.password and not u.query and not u.fragment
    except Exception:
        valid = False
    if not valid or len(key) < 24:
        return None, 'Cần nhập HTTPS Cloudflare URL và API Key trong bridge_config.json'
    return (server, key), None


def request(config, path, data=None):
    server, key = config
    headers = {'X-API-Key': key, 'Accept': 'application/json'}
    payload = None
    if data is not None:
        headers['Content-Type'] = 'application/json'
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(server + path, headers=headers, data=payload, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.loads(response.read(65536).decode('utf-8'))


def poll():
    while True:
        c, error = load_config()
        if error:
            CURRENT.update(state='waiting_config', message=error)
            if CURRENT.get('last_config_error') != error:
                print('[AutoPost Bridge] ' + error, flush=True)
                CURRENT['last_config_error'] = error
        else:
            try:
                r = request(c, '/api/host/heartbeat', {
                    'id': 'enzonic', 'status': 'online',
                    'detail': 'Python outbound bridge online. Zalo / Shopee connectors not installed.'
                })
                config = request(c, '/api/host/config')
                CURRENT.update(state='online', last_cloudflare=int(time.time()), message='Kết nối Cloudflare OK')
                print('[AutoPost Bridge] Cloudflare OK | enabled rules=%s | sending=%s | Zalo=chưa tích hợp' % (
                    config.get('configured_rules', 0), config.get('sending_enabled')), flush=True)
            except urllib.error.HTTPError as e:
                CURRENT.update(state='error', message='Cloudflare HTTP %d' % e.code)
                print('[AutoPost Bridge] Cloudflare HTTP %d: kiểm tra API key / URL' % e.code, flush=True)
            except Exception as e:
                CURRENT.update(state='error', message='Cloudflare không kết nối: '+type(e).__name__)
                print('[AutoPost Bridge] Kết nối lỗi: %s' % type(e).__name__, flush=True)
        time.sleep(30)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/health', '/'):
            self.send_error(404)
            return
        msg = json.dumps({'ok': True, 'app': 'AutoPost Enzonic Bridge 1.2', **CURRENT}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def log_message(self, *args):
        return


if __name__ == '__main__':
    threading.Thread(target=poll, daemon=True).start()
    port = int(os.getenv('SERVER_PORT') or os.getenv('PORT') or '8000')
    print('[AutoPost Bridge] HTTP status port %d. Outbound API chạy mỗi 30 giây.' % port, flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
