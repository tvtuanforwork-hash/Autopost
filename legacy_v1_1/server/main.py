"""AutoPost Personal V1: authenticated single-user job server.

No third-party Zalo/Shopee integration is implemented in this version.
"""
from __future__ import annotations

import hmac
from contextlib import contextmanager
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env', override=False)
_configured_db_path = Path(os.getenv('APP_DB_PATH', 'data/autopost.sqlite3'))
DB_PATH = _configured_db_path if _configured_db_path.is_absolute() else ROOT / _configured_db_path
ADMIN_USER = os.getenv('ADMIN_USER', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', '')
EXTENSION_API_KEY = os.getenv('EXTENSION_API_KEY', '')
if not ADMIN_PASSWORD or not EXTENSION_API_KEY:
    raise RuntimeError('Run python setup.py first: ADMIN_PASSWORD and EXTENSION_API_KEY are required.')

app = FastAPI(title='AutoPost Personal API', docs_url=None, redoc_url=None, openapi_url=None)
basic = HTTPBasic()


def now_ts() -> int:
    return int(time.time())


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA busy_timeout=10000')
    connection.execute('PRAGMA journal_mode=WAL')
    try:
        yield connection
    finally:
        connection.close()


def init_db() -> None:
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL,
            output TEXT,
            error TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            lease_token TEXT,
            lease_until INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, created_at);
        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            capabilities TEXT NOT NULL,
            last_seen INTEGER NOT NULL
        );
        ''')


init_db()


def require_admin(credentials: HTTPBasicCredentials = Depends(basic)) -> bool:
    user_ok = hmac.compare_digest(credentials.username.encode(), ADMIN_USER.encode())
    pass_ok = hmac.compare_digest(credentials.password.encode(), ADMIN_PASSWORD.encode())
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=401, detail='Sai tài khoản hoặc mật khẩu',
                            headers={'WWW-Authenticate': 'Basic realm="AutoPost Personal"'})
    return True


def require_bridge(x_api_key: str | None = Header(default=None)) -> bool:
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), EXTENSION_API_KEY.encode()):
        raise HTTPException(status_code=401, detail='API Key không hợp lệ')
    return True


class NewJob(BaseModel):
    type: Literal['ping', 'convert_links']
    links: list[str] = Field(default_factory=list, max_length=20)

    @field_validator('links')
    @classmethod
    def links_are_urls(cls, values: list[str]) -> list[str]:
        from urllib.parse import urlparse
        result: list[str] = []
        for value in values:
            v = value.strip()
            u = urlparse(v)
            if u.scheme != 'https' or not u.hostname or len(v) > 1024:
                raise ValueError('Chỉ chấp nhận URL HTTPS hợp lệ, tối đa 1024 ký tự')
            result.append(v)
        return result


class Heartbeat(BaseModel):
    client_id: str = Field(min_length=1, max_length=80)
    version: str = Field(default='1.0.0', max_length=40)
    capabilities: list[str] = Field(default_factory=list, max_length=15)


class ClaimRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=80)


class CompleteRequest(BaseModel):
    lease_token: str = Field(min_length=16, max_length=80)
    result: Literal['success', 'unsupported', 'error']
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = Field(default=None, max_length=1000)


def job_as_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        'id': row['id'], 'type': row['type'], 'status': row['status'],
        'payload': json.loads(row['payload']),
        'output': json.loads(row['output']) if row['output'] else None,
        'error': row['error'], 'attempts': row['attempts'],
        'created_at': row['created_at'], 'updated_at': row['updated_at'],
    }


@app.middleware('http')
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"
    return response


@app.get('/health')
def health():
    return {'ok': True, 'service': 'AutoPost Personal V1'}


@app.get('/')
def dashboard(_: bool = Depends(require_admin)):
    return FileResponse(ROOT / 'web' / 'index.html')


@app.get('/dashboard.js')
def dashboard_js(_: bool = Depends(require_admin)):
    return FileResponse(ROOT / 'web' / 'dashboard.js', media_type='text/javascript')


@app.get('/styles.css')
def dashboard_css(_: bool = Depends(require_admin)):
    return FileResponse(ROOT / 'web' / 'styles.css', media_type='text/css')


@app.get('/api/admin/status')
def admin_status(_: bool = Depends(require_admin)):
    with db() as c:
        counts = dict(c.execute('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').fetchall())
        client = c.execute('SELECT id, version, capabilities, last_seen FROM clients ORDER BY last_seen DESC LIMIT 1').fetchone()
    client_data = None
    if client:
        client_data = {'id': client['id'], 'version': client['version'],
                       'capabilities': json.loads(client['capabilities']),
                       'last_seen': client['last_seen'], 'online': now_ts() - client['last_seen'] <= 100}
    return {'server': 'online', 'extension': client_data, 'counts': counts,
            'integrations': {'zalo_reader': os.getenv('ENABLE_ZALO_EXPERIMENTAL','0') == '1', 'shopee_converter': False, 'zalo_sender': os.getenv('ENABLE_ZALO_SENDING','0') == '1'}}


@app.get('/api/admin/jobs')
def admin_jobs(limit: int = 50, _: bool = Depends(require_admin)):
    limit = max(1, min(limit, 100))
    with db() as c:
        rows = c.execute('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', (limit,)).fetchall()
    return {'jobs': [job_as_dict(r) for r in rows]}


@app.post('/api/admin/jobs', status_code=201)
def admin_create_job(job: NewJob, _: bool = Depends(require_admin)):
    if job.type == 'convert_links' and not job.links:
        raise HTTPException(status_code=422, detail='Cần ít nhất một link')
    if job.type == 'ping' and job.links:
        raise HTTPException(status_code=422, detail='Ping không dùng link')
    n = now_ts()
    job_id = uuid.uuid4().hex[:16]
    payload = {'links': job.links} if job.type == 'convert_links' else {'message': 'Kiểm tra kết nối Web ↔ Extension'}
    with db() as c:
        c.execute('INSERT INTO jobs (id,type,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
                  (job_id, job.type, json.dumps(payload, ensure_ascii=False), 'queued', n, n))
    return {'id': job_id, 'status': 'queued', 'type': job.type}


@app.post('/api/admin/jobs/{job_id}/retry')
def admin_retry(job_id: str, _: bool = Depends(require_admin)):
    with db() as c:
        row = c.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='Không tìm thấy công việc')
        if row['status'] not in ('unsupported', 'error'):
            raise HTTPException(status_code=409, detail='Chỉ thử lại công việc lỗi/chưa hỗ trợ')
        c.execute('UPDATE jobs SET status=?, attempts=0, error=NULL, output=NULL, lease_token=NULL, lease_until=NULL, updated_at=? WHERE id=?',
                  ('queued', now_ts(), job_id))
    return {'ok': True}


@app.post('/api/bridge/heartbeat')
def bridge_heartbeat(data: Heartbeat, _: bool = Depends(require_bridge)):
    with db() as c:
        c.execute('''INSERT INTO clients (id,version,capabilities,last_seen) VALUES (?,?,?,?)
                     ON CONFLICT(id) DO UPDATE SET version=excluded.version,
                     capabilities=excluded.capabilities,last_seen=excluded.last_seen''',
                  (data.client_id, data.version, json.dumps(data.capabilities), now_ts()))
    return {'ok': True, 'server_time': now_ts()}


@app.post('/api/bridge/jobs/claim')
def bridge_claim(data: ClaimRequest, _: bool = Depends(require_bridge)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        # Unfinished claims can be retried up to 3 times. A stale lease cannot complete a newer claim.
        n = now_ts()
        c.execute('''UPDATE jobs SET status='queued', lease_token=NULL, lease_until=NULL, updated_at=?
                     WHERE status='leased' AND lease_until < ? AND attempts < 3''', (n, n))
        c.execute('''UPDATE jobs SET status='error', error='Quá 3 lần nhận việc nhưng chưa có kết quả',
                     lease_token=NULL, lease_until=NULL, updated_at=?
                     WHERE status='leased' AND lease_until < ? AND attempts >= 3''', (n, n))
        row = c.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1").fetchone()
        if not row:
            c.commit()
            return {'job': None}
        lease_token = uuid.uuid4().hex
        c.execute('''UPDATE jobs SET status='leased', attempts=attempts+1, lease_token=?,
                     lease_until=?, updated_at=? WHERE id=?''', (lease_token, n + 120, n, row['id']))
        c.commit()
        return {'job': {'id': row['id'], 'type': row['type'], 'payload': json.loads(row['payload']),
                        'lease_token': lease_token}}


@app.post('/api/bridge/jobs/{job_id}/complete')
def bridge_complete(job_id: str, data: CompleteRequest, _: bool = Depends(require_bridge)):
    if len(json.dumps(data.output, ensure_ascii=False)) > 50000:
        raise HTTPException(status_code=413, detail='Output quá lớn')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT status,lease_token,lease_until FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='Không có công việc')
        if row['status'] != 'leased' or not row['lease_token'] or not hmac.compare_digest(row['lease_token'], data.lease_token):
            raise HTTPException(status_code=409, detail='Lease không hợp lệ hoặc đã hết quyền cập nhật')
        if row['lease_until'] < now_ts():
            raise HTTPException(status_code=409, detail='Lease đã hết hạn')
        final_status = {'success': 'done', 'unsupported': 'unsupported', 'error': 'error'}[data.result]
        c.execute('''UPDATE jobs SET status=?,output=?,error=?,lease_token=NULL,lease_until=NULL,
                     updated_at=? WHERE id=?''',
                  (final_status, json.dumps(data.output, ensure_ascii=False), data.error, now_ts(), job_id))
        c.commit()
    if row and job_id:
        from .forwarding import finish_conversion
        finish_conversion(db, job_id, final_status, data.output)
    return {'ok': True, 'status': final_status}


# Isolated, optional Zalo cloud module; legacy ping and extension endpoints untouched.
from .forwarding import register
register(app, db, require_admin, require_bridge, now_ts, ROOT)
