import importlib

from fastapi.testclient import TestClient


def app_client(monkeypatch,tmp_path):
    monkeypatch.setenv('ADMIN_PASSWORD','admin_test_pw')
    monkeypatch.setenv('EXTENSION_API_KEY','test_bridge_key')
    monkeypatch.setenv('APP_DB_PATH',str(tmp_path / 'db.sqlite3'))
    monkeypatch.setenv('ENABLE_ZALO_SENDING','0')
    import server.main as main
    importlib.reload(main)
    return TestClient(main.app),main,('admin','admin_test_pw'),{'X-API-Key':'test_bridge_key'}


def register_rule(c,admin,bridge,only_shopee=True):
    r=c.post('/api/zalo/groups',headers=bridge,json={'groups':[{'id':'source','name':'Test nguồn'},{'id':'dest','name':'Test đích'}]})
    assert r.status_code == 200,r.text
    r=c.post('/api/admin/zalo/rules',auth=admin,json={'source_id':'source','dest_id':'dest','only_shopee':only_shopee,'block_external':True,'enabled':True})
    assert r.status_code == 201,r.text


def test_rules_start_safe_and_require_groups(monkeypatch,tmp_path):
    c,m,admin,bridge=app_client(monkeypatch,tmp_path)
    assert c.get('/api/admin/zalo/overview').status_code == 401
    assert c.post('/api/zalo/groups',json={'groups':[]}).status_code == 401
    invalid=c.post('/api/admin/zalo/rules',auth=admin,json={'source_id':'a','dest_id':'b'})
    assert invalid.status_code == 422
    register_rule(c,admin,bridge)
    o=c.get('/api/admin/zalo/overview',auth=admin).json()
    assert o['sending_enabled'] is False
    assert o['rules'][0]['enabled']==1
    assert o['groups'][0]['name'] in ('Test nguồn','Test đích')
    assert c.get('/api/admin/zalo/qr.png',auth=admin).status_code==404


def test_shopee_conversion_blocks_then_releases(monkeypatch,tmp_path):
    c,m,admin,bridge=app_client(monkeypatch,tmp_path)
    register_rule(c,admin,bridge)
    data={'source_id':'source','message_id':'msg001','text':'Deal https://s.shopee.vn/ABC123'}
    r=c.post('/api/zalo/events',headers=bridge,json=data)
    assert r.status_code==200 and r.json()['waiting_conversion']
    assert c.post('/api/zalo/events',headers=bridge,json=data).json()['reason']=='duplicate'
    overview=c.get('/api/admin/zalo/overview',auth=admin).json()
    assert len(overview['deliveries'])==1
    assert overview['deliveries'][0]['state']=='waiting_conversion'
    assert c.post('/api/zalo/send/claim',headers=bridge,json={}).json()['delivery'] is None
    claim=c.post('/api/bridge/jobs/claim',headers=bridge,json={'client_id':'test'}).json()['job']
    assert claim['type']=='convert_links'
    # Existing extension cannot convert: original link must NEVER be forwarded.
    r=c.post(f"/api/bridge/jobs/{claim['id']}/complete",headers=bridge,json={'lease_token':claim['lease_token'],'result':'unsupported','error':'No converter yet'})
    assert r.status_code==200
    assert c.get('/api/admin/zalo/overview',auth=admin).json()['deliveries'][0]['state']=='conversion_blocked'
    # A user adds a valid converter later, explicitly retries unsupported job.
    c.post(f"/api/admin/jobs/{claim['id']}/retry",auth=admin)
    next_claim=c.post('/api/bridge/jobs/claim',headers=bridge,json={'client_id':'test'}).json()['job']
    c.post(f"/api/bridge/jobs/{claim['id']}/complete",headers=bridge,json={
      'lease_token':next_claim['lease_token'],'result':'success',
      'output':{'convertedLinks':[{'original':'https://s.shopee.vn/ABC123','affiliate':'https://s.shopee.vn/NEW456'}]}
    })
    assert c.get('/api/admin/zalo/overview',auth=admin).json()['deliveries'][0]['state']=='queued'
    # Only now can enable sending. Tests do NOT contact Zalo.
    monkeypatch.setenv('ENABLE_ZALO_SENDING','1')
    job=c.post('/api/zalo/send/claim',headers=bridge,json={}).json()['delivery']
    assert job['destination_id']=='dest'
    assert 'NEW456' in job['text'] and 'ABC123' not in job['text']
    assert c.post('/api/zalo/send/claim',headers=bridge,json={}).json()['delivery'] is None
    assert c.post(f"/api/zalo/send/{job['id']}/complete",headers=bridge,json={'lease':job['lease'],'result':'accepted'}).json()['state']=='sent'


def test_filters_and_uncertain_no_retry(monkeypatch,tmp_path):
    c,m,admin,bridge=app_client(monkeypatch,tmp_path)
    register_rule(c,admin,bridge,only_shopee=False)
    ev={'source_id':'source','message_id':'a','text':'Only text'}
    assert c.post('/api/zalo/events',headers=bridge,json=ev).json()['deliveries']==1
    ev['message_id']='b';ev['text']='https://s.shopee.vn/A https://evil.test/'
    assert c.post('/api/zalo/events',headers=bridge,json=ev).json()['deliveries']==0
    monkeypatch.setenv('ENABLE_ZALO_SENDING','1')
    j=c.post('/api/zalo/send/claim',headers=bridge,json={}).json()['delivery']
    assert j and j['text']=='Only text'
    assert c.post(f"/api/zalo/send/{j['id']}/complete",headers=bridge,json={'lease':j['lease'],'result':'uncertain','detail':'No ack'}).json()['state']=='needs_review'
    assert c.post('/api/zalo/send/claim',headers=bridge,json={}).json()['delivery'] is None
    assert c.get('/api/admin/zalo/overview',auth=admin).json()['deliveries'][0]['state']=='needs_review'
