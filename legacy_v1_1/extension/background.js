'use strict';
const ALARM='autopost-personal-poll';
let inFlight=false;

function validateServerUrl(raw){
  const u=new URL(raw);
  const loopback=u.hostname==='localhost'||u.hostname==='127.0.0.1';
  if(u.protocol!=='https:' && !(u.protocol==='http:' && loopback)) throw new Error('Server từ xa phải sử dụng HTTPS');
  if(u.username||u.password||u.search||u.hash) throw new Error('Server URL không chứa mật khẩu hoặc tham số');
  return u.origin;
}
async function config(){
  const c=await chrome.storage.local.get(['serverUrl','apiKey','clientId']);
  if(!c.serverUrl||!c.apiKey) throw new Error('Chưa cấu hình Server/API Key');
  const server=validateServerUrl(c.serverUrl);
  let clientId=c.clientId;
  if(!clientId){clientId=crypto.randomUUID();await chrome.storage.local.set({clientId});}
  return {server,apiKey:c.apiKey,clientId};
}
async function request(c,path,payload){
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),15000);
  try{
    const res=await fetch(`${c.server}${path}`,{
      method:'POST',cache:'no-store',credentials:'omit',
      headers:{'Content-Type':'application/json','X-API-Key':c.apiKey},
      body:JSON.stringify(payload),signal:ac.signal
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(`${res.status}: ${typeof data.detail==='string'?data.detail:'Lỗi Server'}`);
    return data;
  }finally{clearTimeout(timer);}
}
async function handleJob(job,c){
  if(job.type==='ping'){
    return {result:'success',output:{message:'Web và Extension đã kết nối thành công',clientId:c.clientId,version:chrome.runtime.getManifest().version}};
  }
  if(job.type==='convert_links'){
    return {result:'unsupported',error:'Shopee Converter chưa tích hợp: V1 chỉ kiểm chứng Web ↔ Extension. Không có link nào được chuyển đổi.',output:{receivedLinks:Array.isArray(job.payload?.links)?job.payload.links.length:0}};
  }
  return {result:'unsupported',error:'Không hỗ trợ loại công việc này',output:{}};
}
async function cycle(){
  if(inFlight)return {ok:true,skipped:true};
  inFlight=true;
  try{
    const c=await config();
    await request(c,'/api/bridge/heartbeat',{client_id:c.clientId,version:chrome.runtime.getManifest().version,capabilities:['ping']});
    await chrome.storage.local.set({lastSuccess:Date.now(),lastError:''});
    const {job}=await request(c,'/api/bridge/jobs/claim',{client_id:c.clientId});
    if(!job)return {ok:true,job:null};
    let result;
    try{result=await handleJob(job,c)}
    catch(e){result={result:'error',output:{},error:String(e.message||e)}}
    await request(c,`/api/bridge/jobs/${encodeURIComponent(job.id)}/complete`,{lease_token:job.lease_token,...result});
    return {ok:true,job:job.id,status:result.result};
  }catch(e){
    await chrome.storage.local.set({lastError:String(e.message||e)});
    return {ok:false,error:String(e.message||e)};
  }finally{inFlight=false;}
}
async function ensureAlarm(){
  const alarm=await chrome.alarms.get(ALARM);
  if(!alarm)await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
}
chrome.runtime.onInstalled.addListener(()=>{void ensureAlarm();});
chrome.runtime.onStartup.addListener(()=>{void ensureAlarm();});
chrome.alarms.onAlarm.addListener((alarm)=>{if(alarm.name===ALARM)void cycle();});
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(msg?.type==='CHECK_NOW'){
    void cycle().then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e)}));
    return true;
  }
});
void ensureAlarm();
