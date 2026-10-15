'use strict';
const $=s=>document.getElementById(s);
const labels={queued:'Chờ',leased:'Đang xử lý',done:'Hoàn tất',error:'Lỗi',unsupported:'Chưa hỗ trợ',waiting_conversion:'Chờ đổi Shopee',conversion_blocked:'Chưa có converter',sending:'Đang gửi',awaiting_verification:'Đợi xác minh 60s',verified:'Đã xác minh',failed:'Không tồn tại',needs_review:'Cần kiểm tra'};
const dt=t=>t?new Date(t*1000).toLocaleString('vi-VN'):'—';
const td=s=>{const e=document.createElement('td');e.textContent=String(s??'');return e};
const show=(id,msg)=>$(id).textContent=String(msg||'');
async function api(url,options={}){const r=await fetch(url,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.detail||`HTTP ${r.status}`);return data;}
let groups=[];
const groupName=id=>groups.find(x=>x.id===id)?.name||id;
function fillSelect(id){const el=$(id),previous=el.value;el.replaceChildren();for(const group of groups){const op=document.createElement('option');op.value=group.id;op.textContent=group.name;el.append(op)}if(groups.some(x=>x.id===previous))el.value=previous;}
const empty=(body,n,text)=>{const tr=document.createElement('tr'),cell=td(text);cell.colSpan=n;tr.append(cell);body.append(tr)};
async function refresh(){
 try {
  const [s,j,z]=await Promise.all([api('/api/admin/status'),api('/api/admin/jobs'),api('/api/admin/zalo/overview')]);
  show('cfstate','Hoạt động');show('enzstate',s.hosting?.online?'Đang kết nối':'Offline');show('enzseen',s.hosting?.last_seen?'Lần cuối '+dt(s.hosting.last_seen):'Chưa nhận heartbeat');
  show('zalostate',s.zalo?.online?s.zalo.status||'Kết nối':'Chưa tích hợp');show('zaloseen',s.zalo?.detail||'Node.js Zalo chưa chạy trên Enzonic Python');
  show('extstate',s.extension?.online?'Đã kết nối':'Offline');show('extseen',s.extension?.last_seen?'Lần cuối '+dt(s.extension.last_seen):'Chưa cấu hình extension');
  show('queued',`${(s.counts.queued||0)+(s.counts.leased||0)} Job đang chờ`);show('sendbadge',z.sending_enabled?'Chế độ gửi được bật':'GỬI ĐANG TẮT');
  const jobrows=$('jobrows');jobrows.replaceChildren();if(!j.jobs.length)empty(jobrows,5,'Chưa có Job');
  for(const x of j.jobs){const tr=document.createElement('tr');tr.append(td(x.id.slice(0,9)),td(x.type),td(labels[x.status]||x.status),td(dt(x.updated_at)),td((x.error||JSON.stringify(x.output||{})).slice(0,110)));jobrows.append(tr)}
  const changed=JSON.stringify(groups)!==JSON.stringify(z.groups);groups=z.groups||[];if(changed){fillSelect('source');fillSelect('dest')};show('groupsCount',groups.length+' nhóm');
  const rules=$('rulerows');rules.replaceChildren();if(!z.rules.length)empty(rules,5,'Chưa có quy tắc');
  for(const r of z.rules){const tr=document.createElement('tr');tr.append(td(groupName(r.source_id)),td(groupName(r.dest_id)),td(r.only_shopee?'Chỉ Shopee':'Mọi tin'),td(r.enabled?'Đang bật':'Đang tắt'));
   const actions=document.createElement('td');const sw=document.createElement('button');sw.className='secondary';sw.textContent=r.enabled?'Tắt':'Bật';sw.onclick=()=>ruleAction(`/api/admin/zalo/rules/${r.id}/state`,{enabled:!r.enabled});actions.append(sw);
   const rm=document.createElement('button');rm.className='danger';rm.textContent='Xóa';rm.onclick=()=>{if(confirm('Xoá quy tắc này?'))ruleAction(`/api/admin/zalo/rules/${r.id}/delete`,{})};actions.append(rm);tr.append(actions);rules.append(tr)}
  const deliveries=$('deliveryrows');deliveries.replaceChildren();if(!z.deliveries.length)empty(deliveries,4,'Chưa có lượt gửi');for(const d of z.deliveries){const tr=document.createElement('tr');tr.append(td(groupName(d.dest_id)),td(labels[d.state]||d.state),td(dt(d.updated_at)),td(d.error||'—'));deliveries.append(tr)}
 } catch(e){show('cfstate','Lỗi API');show('jobmsg',e.message)}
}
async function ruleAction(path,payload){try{await api(path,{method:'POST',body:JSON.stringify(payload)});await refresh()}catch(e){show('rulemsg',e.message)}}
$('reload').onclick=refresh;
$('ping').onclick=async()=>{try{const x=await api('/api/admin/jobs',{method:'POST',body:JSON.stringify({type:'ping',links:[]})});show('jobmsg','Đã tạo ping '+x.id);await refresh()}catch(e){show('jobmsg',e.message)}};
$('convert').onclick=async()=>{try{const links=$('links').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const x=await api('/api/admin/jobs',{method:'POST',body:JSON.stringify({type:'convert_links',links})});show('jobmsg','Đã tạo yêu cầu '+x.id+' – cần extension converter thật');await refresh()}catch(e){show('jobmsg',e.message)}};
$('createRule').onclick=async()=>{try{await api('/api/admin/zalo/rules',{method:'POST',body:JSON.stringify({source_id:$('source').value,dest_id:$('dest').value,only_shopee:$('only').checked,block_external:$('external').checked})});show('rulemsg','Đã tạo quy tắc ở trạng thái TẮT');await refresh()}catch(e){show('rulemsg',e.message)}};
refresh();setInterval(refresh,30000);
