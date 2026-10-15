"""Only optional TEST data for D1 flow. Never connects to Zalo or sends messages."""
from main import load_config, request

c, e = load_config()
if e: raise SystemExit(e)
for path, payload in [
 ('/api/zalo/groups', {'groups':[
    {'id':'demo-source','name':'DEMO — Nhóm nguồn'},
    {'id':'demo-destination','name':'DEMO — Nhóm đích'}]}),
 ('/api/zalo/heartbeat', {'status':'demo-only', 'detail':'Dữ liệu DEMO không phải kết nối Zalo thật'})]:
 print(path,request(c,path,payload))
print('Đã tạo 2 nhóm DEMO. Vào Cloudflare Web tạo quy tắc (mặc định tắt).')
