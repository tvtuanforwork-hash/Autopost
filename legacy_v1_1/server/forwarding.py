"""Isolated Zalo group rules and delivery pipeline.

Safety: no automatic retry of an ambiguous send; no silent sending of
unconverted Shopee links; enable flags default OFF.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

URL_RX = re.compile(r'https?://[^\s<>"\'()]+', re.I)
SHOPEE_DOMAINS = {'shopee.vn', 's.shopee.vn', 'shopee.com', 'shopee.com.my', 'shopee.sg'}


def links_in(text: str) -> list[str]:
    return list(dict.fromkeys(s.rstrip('.,;!?)') for s in URL_RX.findall(text)))


def is_shopee(url: str) -> bool:
    return (urlparse(url).hostname or '').lower() in SHOPEE_DOMAINS


def init_tables(db):
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, dest_id TEXT NOT NULL,
            only_shopee INTEGER NOT NULL DEFAULT 1, block_external INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 0,
            UNIQUE(source_id,dest_id), CHECK(source_id <> dest_id)
        );
        CREATE TABLE IF NOT EXISTS source_messages (
            msg_key TEXT PRIMARY KEY, source_id TEXT NOT NULL, msg_id TEXT NOT NULL,
            text TEXT NOT NULL, created_at INTEGER NOT NULL, conversion_job_id TEXT
        );
        CREATE TABLE IF NOT EXISTS deliveries (
            id TEXT PRIMARY KEY, msg_key TEXT NOT NULL, dest_id TEXT NOT NULL,
            text TEXT NOT NULL, state TEXT NOT NULL, error TEXT, lease TEXT,
            lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            UNIQUE(msg_key,dest_id)
        );
        CREATE TABLE IF NOT EXISTS worker_state (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT NOT NULL, last_seen INTEGER NOT NULL
        );
        ''')


class RuleIn(BaseModel):
    source_id: str = Field(min_length=1, max_length=100)
    dest_id: str = Field(min_length=1, max_length=100)
    only_shopee: bool = True
    block_external: bool = True
    enabled: bool = False


class RuleChange(BaseModel):
    enabled: bool


class Group(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=250)


class GroupsIn(BaseModel):
    groups: list[Group] = Field(max_length=1000)


class WorkerState(BaseModel):
    status: str = Field(max_length=35)
    detail: str = Field(default='', max_length=250)


class Event(BaseModel):
    source_id: str = Field(min_length=1, max_length=100)
    message_id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=15000)
    is_self: bool = False
    media: bool = False


class SendFinish(BaseModel):
    lease: str = Field(min_length=20, max_length=80)
    result: str = Field(pattern='^(accepted|uncertain)$')
    detail: str = Field(default='', max_length=500)


def register(app, db, require_admin, require_bridge, now_ts, root):
    init_tables(db)
    qr_file = Path(root) / 'data' / 'zalo' / 'qr.png'

    @app.get('/api/admin/zalo/qr.png')
    def qr_image(_: bool = Depends(require_admin)):
        if not qr_file.exists():
            raise HTTPException(404, 'Chưa có QR; xem trạng thái Zalo Worker')
        return FileResponse(qr_file, media_type='image/png', headers={'Cache-Control': 'no-store'})

    @app.get('/api/admin/zalo/overview')
    def overview(_: bool = Depends(require_admin)):
        with db() as c:
            groups = [dict(r) for r in c.execute('SELECT id,name FROM groups ORDER BY name LIMIT 1000')]
            rules = [dict(r) for r in c.execute('SELECT * FROM rules ORDER BY id DESC')]
            deliveries = [dict(r) for r in c.execute('SELECT id, msg_key, dest_id, state, error, created_at, updated_at FROM deliveries ORDER BY created_at DESC LIMIT 80')]
            worker = c.execute("SELECT status,detail,last_seen FROM worker_state WHERE id='zalo'").fetchone()
        return {
            'groups': groups, 'rules': rules, 'deliveries': deliveries,
            'worker': dict(worker) if worker else None,
            'qr_ready': qr_file.exists(),
            'zalo_experimental': os.getenv('ENABLE_ZALO_EXPERIMENTAL','0') == '1',
            'sending_enabled': os.getenv('ENABLE_ZALO_SENDING','0') == '1'
        }

    @app.post('/api/admin/zalo/rules', status_code=201)
    def create_rule(data: RuleIn, _: bool = Depends(require_admin)):
        if data.source_id == data.dest_id:
            raise HTTPException(422, 'Nhóm nguồn không được trùng nhóm đích')
        with db() as c:
            ids = {row['id'] for row in c.execute('SELECT id FROM groups WHERE id IN (?,?)', (data.source_id, data.dest_id))}
            if {data.source_id, data.dest_id} != ids:
                raise HTTPException(422, 'Chọn nhóm từ danh sách đồng bộ')
            try:
                cur = c.execute('INSERT INTO rules (source_id,dest_id,only_shopee,block_external,enabled) VALUES (?,?,?,?,?)',
                    (data.source_id,data.dest_id,int(data.only_shopee),int(data.block_external),int(data.enabled)))
            except sqlite3.IntegrityError:
                raise HTTPException(409, 'Quy tắc nguồn → đích đã tồn tại')
        return {'id': cur.lastrowid}

    @app.post('/api/admin/zalo/rules/{rule_id}/state')
    def rule_state(rule_id: int, data: RuleChange, _: bool = Depends(require_admin)):
        with db() as c:
            cur = c.execute('UPDATE rules SET enabled=? WHERE id=?',(int(data.enabled),rule_id))
        if not cur.rowcount:
            raise HTTPException(404,'Không thấy quy tắc')
        return {'ok':True}

    @app.post('/api/admin/zalo/rules/{rule_id}/delete')
    def rule_delete(rule_id: int, _: bool = Depends(require_admin)):
        with db() as c:
            c.execute('DELETE FROM rules WHERE id=?',(rule_id,))
        return {'ok':True}

    @app.post('/api/zalo/heartbeat')
    def worker_heartbeat(data: WorkerState, _: bool = Depends(require_bridge)):
        with db() as c:
            c.execute('INSERT INTO worker_state (id,status,detail,last_seen) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,detail=excluded.detail,last_seen=excluded.last_seen',
                      ('zalo',data.status,data.detail,now_ts()))
        return {'ok':True}

    @app.post('/api/zalo/groups')
    def groups_sync(data: GroupsIn, _: bool = Depends(require_bridge)):
        with db() as c:
            for g in data.groups:
                c.execute('INSERT INTO groups(id,name,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at',
                          (g.id,g.name,now_ts()))
        return {'ok':True,'count':len(data.groups)}

    @app.post('/api/zalo/events')
    def on_event(data: Event, _: bool = Depends(require_bridge)):
        if data.is_self or data.media:
            return {'accepted':False,'reason':'self_or_media_unsupported'}
        key = data.source_id + ':' + data.message_id
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            existing = c.execute('SELECT 1 FROM source_messages WHERE msg_key=?',(key,)).fetchone()
            if existing:
                c.commit(); return {'accepted':False,'reason':'duplicate'}
            c.execute('INSERT INTO source_messages(msg_key,source_id,msg_id,text,created_at) VALUES (?,?,?,?,?)',
                      (key,data.source_id,data.message_id,data.text,now_ts()))
            rules = c.execute('SELECT * FROM rules WHERE enabled=1 AND source_id=?',(data.source_id,)).fetchall()
            urls = links_in(data.text)
            shopee = [u for u in urls if is_shopee(u)]
            dests=[]
            for r in rules:
                if r['only_shopee'] and not shopee: continue
                if r['block_external'] and any(not is_shopee(u) for u in urls): continue
                dests.append(r['dest_id'])
            if not dests:
                c.commit(); return {'accepted':True,'deliveries':0}
            # Do not leak original Shopee links to destination while converter is unavailable.
            state='waiting_conversion' if shopee else 'queued'
            n=now_ts()
            for dst in set(dests):
                c.execute('INSERT OR IGNORE INTO deliveries(id,msg_key,dest_id,text,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
                          (uuid.uuid4().hex[:20],key,dst,data.text,state,n,n))
            if shopee:
                job_id=uuid.uuid4().hex[:16]
                c.execute('INSERT INTO jobs(id,type,payload,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
                          (job_id,'convert_links',json.dumps({'links':shopee}), 'queued',n,n))
                c.execute('UPDATE source_messages SET conversion_job_id=? WHERE msg_key=?',(job_id,key))
            c.commit()
        return {'accepted':True,'deliveries':len(set(dests)),'waiting_conversion': bool(shopee)}

    @app.post('/api/zalo/send/claim')
    def send_claim(_: bool = Depends(require_bridge)):
        if os.getenv('ENABLE_ZALO_SENDING','0') != '1':
            return {'delivery':None,'reason':'sending_disabled'}
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            n=now_ts()
            # An expired send may have succeeded on Zalo. Never requeue blindly.
            c.execute("UPDATE deliveries SET state='needs_review', error='Hết thời gian chờ: không tự gửi lại để tránh trùng',lease=NULL,updated_at=? WHERE state='sending' AND lease_until < ?", (n,n))
            if c.execute("SELECT 1 FROM deliveries WHERE state='sending' LIMIT 1").fetchone():
                c.commit(); return {'delivery':None}
            last=c.execute("SELECT MAX(updated_at) AS t FROM deliveries WHERE state IN ('sent','needs_review')").fetchone()['t'] or 0
            if n-last < max(3,int(os.getenv('ZALO_SEND_INTERVAL_SECONDS','10'))):
                c.commit(); return {'delivery':None}
            row=c.execute("SELECT * FROM deliveries WHERE state='queued' ORDER BY created_at LIMIT 1").fetchone()
            if not row:
                c.commit(); return {'delivery':None}
            token=uuid.uuid4().hex
            c.execute("UPDATE deliveries SET state='sending',lease=?,lease_until=?,updated_at=? WHERE id=?",(token,n+90,n,row['id']))
            c.commit()
            return {'delivery':{'id':row['id'],'destination_id':row['dest_id'],'text':row['text'],'lease':token}}

    @app.post('/api/zalo/send/{delivery_id}/complete')
    def send_complete(delivery_id: str, data: SendFinish, _: bool = Depends(require_bridge)):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT state,lease,lease_until FROM deliveries WHERE id=?',(delivery_id,)).fetchone()
            if not r or r['state']!='sending' or r['lease']!=data.lease or r['lease_until'] < now_ts():
                raise HTTPException(409,'Send lease không hợp lệ')
            state='sent' if data.result=='accepted' else 'needs_review'
            c.execute('UPDATE deliveries SET state=?,error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=?',
                      (state,data.detail or None,now_ts(),delivery_id))
            c.commit()
        return {'ok':True,'state':state}

    @app.post('/api/admin/zalo/deliveries/{delivery_id}/retry')
    def delivery_manual_retry(delivery_id: str, _: bool = Depends(require_admin)):
        with db() as c:
            r=c.execute('SELECT state FROM deliveries WHERE id=?',(delivery_id,)).fetchone()
            if not r or r['state']!='needs_review':
                raise HTTPException(409,'Chỉ xác nhận thử lại các mục cần kiểm tra')
            c.execute("UPDATE deliveries SET state='queued',error=NULL,lease=NULL,lease_until=NULL,updated_at=? WHERE id=?",(now_ts(),delivery_id))
        return {'ok':True}


def finish_conversion(db, job_id: str, outcome: str, output: dict):
    """Update pending deliveries only after full, verified mapping is returned."""
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        rows=c.execute('SELECT msg_key,text FROM source_messages WHERE conversion_job_id=?',(job_id,)).fetchall()
        for row in rows:
            urls=[u for u in links_in(row['text']) if is_shopee(u)]
            converted=output.get('convertedLinks') if outcome == 'done' else None
            m={}
            if isinstance(converted,list):
                for item in converted:
                    if not isinstance(item,dict):continue
                    a,b=item.get('original'),item.get('affiliate')
                    if isinstance(a,str) and isinstance(b,str) and b.startswith('https://') and is_shopee(b):m[a]=b
            ok=bool(urls) and all(u in m for u in urls)
            if ok:
                text=row['text']
                for a,b in m.items():
                    text=text.replace(a,b)
                c.execute("UPDATE deliveries SET text=?,state='queued',error=NULL,updated_at=? WHERE msg_key=? AND state IN ('waiting_conversion','conversion_blocked')",(text,int(time.time()),row['msg_key']))
            else:
                c.execute("UPDATE deliveries SET state='conversion_blocked',error='Chưa có kết quả đổi link Shopee hợp lệ; không gửi link gốc',updated_at=? WHERE msg_key=? AND state IN ('waiting_conversion','conversion_blocked')",(int(time.time()),row['msg_key']))
        c.commit()
