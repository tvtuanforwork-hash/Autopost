import importlib
import json
import os
import sys

from fastapi.testclient import TestClient


def test_api_end_to_end(monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD', 'test_admin_password_strong')
    monkeypatch.setenv('EXTENSION_API_KEY', 'test_extension_key_strong')
    monkeypatch.setenv('APP_DB_PATH', str(tmp_path / 'test.sqlite3'))
    import server.main as main
    importlib.reload(main)
    client = TestClient(main.app)
    web_auth = ('admin', 'test_admin_password_strong')
    bridge_headers = {'X-API-Key': 'test_extension_key_strong'}
    assert client.get('/health').json()['ok']
    assert client.get('/api/admin/status').status_code == 401
    assert client.get('/api/admin/status', auth=('admin','bad')).status_code == 401
    assert client.get('/').status_code == 401
    assert client.get('/',auth=web_auth).status_code == 200
    assert client.post('/api/bridge/heartbeat',json={'client_id':'browser1'}).status_code == 401
    assert client.post('/api/bridge/heartbeat',headers=bridge_headers,json={'client_id':'browser1','version':'1.0.0','capabilities':['ping']}).json()['ok']
    assert client.get('/api/admin/status',auth=web_auth).json()['extension']['online']
    job = client.post('/api/admin/jobs',auth=web_auth,json={'type':'ping'}).json()
    assert job['status'] == 'queued'
    lease = client.post('/api/bridge/jobs/claim',headers=bridge_headers,json={'client_id':'browser1'}).json()['job']
    assert lease['id'] == job['id']
    assert client.post('/api/bridge/jobs/claim',headers=bridge_headers,json={'client_id':'browser2'}).json()['job'] is None
    assert client.post(f"/api/bridge/jobs/{job['id']}/complete",headers=bridge_headers,json={'lease_token':'wrongwrongwrongwrong','result':'success','output':{}}).status_code == 409
    complete = client.post(f"/api/bridge/jobs/{job['id']}/complete",headers=bridge_headers,json={'lease_token':lease['lease_token'],'result':'success','output':{'message':'pong'}})
    assert complete.status_code == 200
    assert complete.json()['status'] == 'done'
    assert client.post(f"/api/bridge/jobs/{job['id']}/complete",headers=bridge_headers,json={'lease_token':lease['lease_token'],'result':'success'}).status_code == 409
    jobs = client.get('/api/admin/jobs',auth=web_auth).json()['jobs']
    assert len(jobs) == 1 and jobs[0]['output'] == {'message':'pong'}
    assert client.post('/api/admin/jobs',auth=web_auth,json={'type':'convert_links','links':['http://bad-link']}).status_code == 422
    job2 = client.post('/api/admin/jobs',auth=web_auth,json={'type':'convert_links','links':['https://s.shopee.vn/example']}).json()
    lease2 = client.post('/api/bridge/jobs/claim',headers=bridge_headers,json={'client_id':'browser1'}).json()['job']
    assert lease2['id'] == job2['id']
    result2 = client.post(f"/api/bridge/jobs/{job2['id']}/complete",headers=bridge_headers,json={'lease_token':lease2['lease_token'],'result':'unsupported','error':'Not integrated'}).json()
    assert result2['status'] == 'unsupported'
    retry = client.post(f"/api/admin/jobs/{job2['id']}/retry",auth=web_auth)
    assert retry.status_code == 200
