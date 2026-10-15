/* Experimental personal Zalo connector. Unofficial zca-js API; opt-in only.
 * QR file is shared with FastAPI via /app/data/zalo/qr.png, never public-static.
 * Session is AES-256-GCM encrypted at rest with a server-held key.
 */
import {Zalo, ThreadType} from 'zca-js';
import {CookieJar} from 'tough-cookie';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if(process.env.ENABLE_ZALO_EXPERIMENTAL !== '1') throw new Error('Zalo worker is opt-in: set ENABLE_ZALO_EXPERIMENTAL=1 in .env');
const base = process.env.APP_DATA_DIR || '/app/data';
const workDir = path.join(base, 'zalo');
fs.mkdirSync(workDir, {recursive:true,mode:0o700});
const qrFile = path.join(workDir,'qr.png');
const sessionFile=path.join(workDir,'session.enc');
const API='http://autopost:8000';
const key=process.env.EXTENSION_API_KEY;
const vaultKey=process.env.ZALO_VAULT_KEY;
if(!key || !/^[a-f0-9]{64}$/i.test(vaultKey || '')) throw new Error('Missing X-API-Key or 64 hex ZALO_VAULT_KEY');
const cipherKey=Buffer.from(vaultKey,'hex');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let status='initializing';
let detail='';
let api=null;

async function request(uri,data){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(API+uri,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':key},body:JSON.stringify(data),signal:controller.signal});
    const json=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(`${r.status}: ${JSON.stringify(json)}`);
    return json;
  }finally{clearTimeout(timer)}
}
async function requestEventWithRetry(payload){
  // Retry only the idempotent ingest endpoint; SQLite rejects duplicate message IDs.
  for(let n=0;n<4;n++){
    try{return await request('/api/zalo/events',payload)}
    catch(e){
      if(n===3){console.warn('Event ingest still failing:',e.message);return null;}
      await sleep(1000*2**n);
    }
  }
}
function encryptedWrite(object){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',cipherKey,iv);
  const bytes=Buffer.from(JSON.stringify(object),'utf8');
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const result=Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);
  fs.writeFileSync(sessionFile,result,{mode:0o600});
  fs.chmodSync(sessionFile,0o600);
}
function encryptedRead(){
  const data=fs.readFileSync(sessionFile);
  if(data.length<29)throw new Error('Encrypted session damaged');
  const decipher=crypto.createDecipheriv('aes-256-gcm',cipherKey,data.subarray(0,12));
  decipher.setAuthTag(data.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString());
}
async function heartbeat(){
  try{await request('/api/zalo/heartbeat',{status,detail});}catch(e){console.warn('Heartbeat',e.message)}
}
async function login(zalo){
  if(fs.existsSync(sessionFile)){
    try{
      const session=encryptedRead();
      const cookie=CookieJar.deserializeSync(session.cookie);
      const restored=await zalo.login({cookie,imei:session.imei,userAgent:session.userAgent});
      console.info('Restored Zalo session');
      return restored;
    }catch(e){console.warn('Saved session rejected:',e.message)}
  }
  status='waiting_qr';detail='Đang tạo QR trên máy chủ';await heartbeat();
  try{fs.unlinkSync(qrFile)}catch{}
  const next=await zalo.loginQR({qrPath:qrFile});
  const ctx=next.getContext();
  try{
    // Save only session essentials, never log cookies or write raw credentials.
    encryptedWrite({cookie:next.getCookie().toJSON(),imei:ctx.imei,userAgent:ctx.userAgent});
  }catch(e){console.warn('Could not persist session, next restart may require QR:',e.message)}
  try{fs.unlinkSync(qrFile)}catch{}
  return next;
}

async function syncGroups(){
  const result=await api.getAllGroups();
  const groupIds=Object.keys(result.gridVerMap||{});
  const groups=[];
  for(let i=0;i<groupIds.length;i+=25){
    const ids=groupIds.slice(i,i+25);
    try{
      const info=await api.getGroupInfo(ids);
      for(const id of ids){
        const g=info.gridInfoMap?.[id];
        groups.push({id,name:String(g?.name || g?.groupName || id)});
      }
    }catch(e){
      console.warn('Group metadata unavailable:',e.message);
      for(const id of ids)groups.push({id,name:id});
    }
  }
  await request('/api/zalo/groups',{groups});
  console.info('Synced group count:',groups.length);
}

async function deliveryCycle(){
  if(status!=='active' || !api)return;
  const {delivery}=await request('/api/zalo/send/claim',{});
  if(!delivery)return;
  let result='uncertain',description='';
  try{
    await api.sendMessage({msg:delivery.text},delivery.destination_id,ThreadType.Group);
    result='accepted';description='API sendMessage accepted (not independently verified in chat)';
  }catch(e){description=`Send not confirmed: ${String(e.message||e).slice(0,300)}`;}
  try{await request(`/api/zalo/send/${encodeURIComponent(delivery.id)}/complete`,{lease:delivery.lease,result,detail:description})}
  catch(e){console.warn('Send acknowledgment failed; check needs_review:',e.message)}
}

async function main(){
  const zalo=new Zalo({selfListen:false, logging:false,checkUpdate:false});
  api=await login(zalo);
  status='active';detail='Đã kết nối; Zalo listener đang chạy';await heartbeat();
  api.listener.on('message',(m)=>{
    if(m.type!==ThreadType.Group || m.isSelf || typeof m.data?.content!=='string')return;
    const text=m.data.content;
    // Message ID fields can vary across library versions: do NOT fall back to
    // time/random identifiers (which would break duplicate prevention).
    const msgId=m.data?.msgId || m.data?.msgIdClient || m.data?.cliMsgId;
    if(!msgId){console.warn('Skip message without stable id');return;}
    void requestEventWithRetry({source_id:String(m.threadId),message_id:String(msgId),text,is_self:false,media:false});
  });
  api.listener.on('error',err=>{status='error';detail=`Zalo listener: ${String(err).slice(0,130)}`;void heartbeat();});
  api.listener.start();
  await syncGroups().catch(e=>console.warn('Sync groups failed:',e.message));
  setInterval(()=>void heartbeat(),15000);
  setInterval(()=>void syncGroups().catch(e=>console.warn('Sync groups failed:',e.message)),10*60*1000);
  let busy=false;
  setInterval(async()=>{
    if(busy)return;
    busy=true;try{await deliveryCycle()}catch(e){console.warn('Delivery cycle:',e.message)}finally{busy=false}
  },3000);
}
main().catch(async e=>{
  status='error';detail=String(e.message||e).slice(0,200);
  console.error('Zalo worker failed:',detail);
  await heartbeat();
  // Exit so Docker can restart; expired QR/cookie may require new login.
  // Avoid rapid QR-login retry loops after a failed session.
  await sleep(30000);
  process.exit(1);
});
