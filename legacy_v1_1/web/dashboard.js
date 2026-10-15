'use strict';
const $ = (id) => document.getElementById(id);
const names = {queued:'Chờ',leased:'Đang nhận',done:'Thành công',unsupported:'Chưa hỗ trợ',error:'Lỗi'};
async function api(path, options={}) {
  const init = {...options, headers: {'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'};
  const res = await fetch(path, init);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail || `Lỗi ${res.status}`);
  return data;
}
function cell(text){const e=document.createElement('td');e.textContent=String(text??'');return e}
function time(ts){return ts?new Date(ts*1000).toLocaleString('vi-VN'):'—'}
function stateText(s){return names[s]||s}
async function refresh(){
 try {
  const [status, history]=await Promise.all([api('/api/admin/status'),api('/api/admin/jobs')]);
  $('serverStatus').textContent='● Server hoạt động';$('serverStatus').style.color='#65d6a0';
  $('serverCard').textContent='Online';
  const ex=status.extension;
  $('bridgeCard').textContent=ex?.online?'Online':'Offline';
  $('bridgeSeen').textContent=ex?`Gặp lần cuối: ${time(ex.last_seen)}`:'Chưa nhận heartbeat';
  $('bridgeStatus').textContent=ex?.online?'Đã kết nối':'Chưa kết nối';
  $('queuedCount').textContent=(status.counts.queued||0)+(status.counts.leased||0);
  $('doneCount').textContent=status.counts.done||0;
  $('totalCount').textContent=`${history.jobs.length} Job gần nhất`;
  const body=$('jobsBody');body.replaceChildren();
  if(!history.jobs.length){const tr=document.createElement('tr'),td=cell('Chưa có công việc');td.colSpan=6;td.className='empty';tr.append(td);body.append(tr)}
  for (const job of history.jobs){
    const tr=document.createElement('tr');
    tr.append(cell(job.id),cell(job.type));
    const td=document.createElement('td');const tag=document.createElement('span');tag.className=`pill ${job.status}`;tag.textContent=stateText(job.status);td.append(tag);tr.append(td);
    tr.append(cell(job.attempts),cell(time(job.updated_at)));
    const info=job.error||((job.output&&JSON.stringify(job.output))||'—');const t=cell(info.length>180?`${info.slice(0,180)}…`:info);t.title=info;tr.append(t);body.append(tr);
  }
 } catch(e){$('serverStatus').textContent='● Không truy cập được Server';$('serverStatus').style.color='#ffbb7a';$('submitMessage').textContent=e.message;}
}
async function submitJob(type, links=[]){
 try{ $('submitMessage').textContent='Đang tạo công việc…';const job=await api('/api/admin/jobs',{method:'POST',body:JSON.stringify({type,links})});$('submitMessage').textContent=`Đã tạo ${job.id}. Extension sẽ nhận khi trực tuyến.`;await refresh();}
 catch(e){$('submitMessage').textContent=e.message;}
}
$('refreshButton').addEventListener('click',refresh);
$('pingButton').addEventListener('click',()=>submitJob('ping'));
$('convertButton').addEventListener('click',()=>{
 const links=$('linkInput').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(!links.length){$('submitMessage').textContent='Hãy nhập ít nhất một URL HTTPS';return}
 submitJob('convert_links',links);
});
refresh();setInterval(refresh,30000);

// V1.1 Zalo cloud features. Existing Web↔Extension test workflow remains intact.
const deliveryState = {queued:'Chờ gửi',waiting_conversion:'Đợi Shopee',conversion_blocked:'Thiếu converter',sending:'Đang gửi',sent:'API đã nhận',needs_review:'Cần kiểm tra'};
let recentGroupIds = '';
function ruleDisplayName(id){return (window.__zaloGroups||[]).find(g=>g.id===id)?.name||id}
function selectGroups(elementId,groups){
 const s=$(elementId), selected=s.value;
 s.replaceChildren(); const first=document.createElement('option');first.value='';first.textContent='Chọn nhóm';s.append(first);
 for(const g of groups){const op=document.createElement('option');op.value=g.id;op.textContent=g.name+' · '+g.id;s.append(op)}
 if([...s.options].some(o=>o.value===selected))s.value=selected;
}
async function refreshZalo(){
 try{
  const data=await api('/api/admin/zalo/overview');
  window.__zaloGroups=data.groups;
  const w=data.worker;
  $('zaloState').textContent=w?.status||'Chưa chạy';
  $('zaloNote').textContent=w?`${w.detail} · ${time(w.last_seen)} · ${data.sending_enabled?'ĐÃ BẬT GỬI':'TẮT GỬI AN TOÀN'}`:'Chưa có worker; làm theo HƯỚNG_DẪN_CLOUD.md để cài Cloud.';
  if(data.qr_ready){ $('zaloQR').hidden=false;$('noQR').hidden=true; }
  else { $('zaloQR').hidden=true;$('noQR').hidden=false; }
  const signature=JSON.stringify(data.groups);
  if(signature!==recentGroupIds){ recentGroupIds=signature;selectGroups('ruleSource',data.groups);selectGroups('ruleDestination',data.groups); }
  const rules=$('rulesBody');rules.replaceChildren();
  for(const r of data.rules){
    const tr=document.createElement('tr');tr.append(cell(ruleDisplayName(r.source_id)),cell(ruleDisplayName(r.dest_id)),cell(r.only_shopee?'Chỉ Shopee':'Mọi tin'));
    const state=document.createElement('td');const toggle=document.createElement('button');toggle.className=r.enabled?'secondary':'primary';toggle.textContent=r.enabled?'Tắt rule':'Bật rule';toggle.addEventListener('click',async()=>{try{await api(`/api/admin/zalo/rules/${r.id}/state`,{method:'POST',body:JSON.stringify({enabled:!r.enabled})});await refreshZalo()}catch(e){$('ruleMessage').textContent=e.message}});state.append(toggle);tr.append(state);
    const remove=document.createElement('td'),btn=document.createElement('button');btn.className='secondary';btn.textContent='Xoá';btn.addEventListener('click',async()=>{if(!confirm('Xoá quy tắc này?'))return;await api(`/api/admin/zalo/rules/${r.id}/delete`,{method:'POST'});await refreshZalo()});remove.append(btn);tr.append(remove);rules.append(tr);
  }
  const body=$('deliveriesBody');body.replaceChildren();
  $('zaloQueueCount').textContent=String(data.deliveries.length)+' gần đây';
  for(const d of data.deliveries){const tr=document.createElement('tr');tr.append(cell(ruleDisplayName(d.dest_id)),cell(deliveryState[d.state]||d.state),cell(time(d.updated_at)),cell(d.error||'—'));body.append(tr)}
 }catch(e){ $('zaloNote').textContent='Lỗi tải Zalo module: '+e.message; }
}
$('addRule').addEventListener('click',async()=>{
 const data={source_id:$('ruleSource').value,dest_id:$('ruleDestination').value,only_shopee:$('ruleOnlyShopee').checked,block_external:$('ruleBlockExternal').checked,enabled:false};
 try{await api('/api/admin/zalo/rules',{method:'POST',body:JSON.stringify(data)});$('ruleMessage').textContent='Đã tạo rule, đang TẮT. Bật thủ công khi sẵn sàng.';await refreshZalo()}catch(e){$('ruleMessage').textContent=e.message}
});
function reloadQR(){ $('zaloQR').src='/api/admin/zalo/qr.png?ts='+Date.now(); }
$('reloadQR').addEventListener('click',reloadQR);
$('zaloQR').addEventListener('error',()=>{$('zaloQR').hidden=true;$('noQR').hidden=false});
$('zaloQR').addEventListener('load',()=>{$('zaloQR').hidden=false;$('noQR').hidden=true});
refreshZalo();setInterval(()=>{void refreshZalo();reloadQR()},15000);
