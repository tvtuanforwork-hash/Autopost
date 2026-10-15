import { linksIn,isShopee,validURL,chooseDestinations,validateConversion,replaceLinks } from './rules.js';

const now=()=>Math.floor(Date.now()/1000);
const id=()=>crypto.randomUUID();
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const fail=(code,detail)=>json({detail},code);
const parse=(s,fallback=null)=>{try{return JSON.parse(s)}catch{return fallback}};
async function body(req){const n=Number(req.headers.get('content-length')||0);if(n>60000)throw new Error('Payload quá lớn');const s=await req.text();if(s.length>60000)throw new Error('Payload quá lớn');return parse(s,{});}
async function secretEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const enc=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(a)),crypto.subtle.digest('SHA-256',enc.encode(b))]);const A=new Uint8Array(x),B=new Uint8Array(y);let d=0;for(let i=0;i<A.length;i++)d|=A[i]^B[i];return d===0;}
async function adminAuth(request,env){
  if(!env.ADMIN_PASSWORD||!env.ADMIN_USER)return false;
  const a=request.headers.get('authorization')||'';if(!a.startsWith('Basic '))return false;
  try{const creds=atob(a.slice(6)),i=creds.indexOf(':');return i>0 && await secretEqual(creds.slice(0,i),env.ADMIN_USER) && await secretEqual(creds.slice(i+1),env.ADMIN_PASSWORD);}catch{return false;}
}
async function bridgeAuth(request,env){return !!env.BRIDGE_API_KEY && await secretEqual(request.headers.get('x-api-key')||'',env.BRIDGE_API_KEY)}
const unauthorized=()=>fail(401,'Chưa đăng nhập hoặc thông tin đăng nhập không đúng');
const authChallenge=()=>json({detail:'Cần đăng nhập AutoPost'},401,{'WWW-Authenticate':'Basic realm="AutoPost Personal Cloudflare"'});
const okid=(v,max=120)=>typeof v==='string'&&v.length>0&&v.length<=max;
const nums=(v)=>Number.isInteger(v)&&v>0;
const detail=(e)=> String(e?.message||e).slice(0,200);

export default { async fetch(request,env){
  const p=new URL(request.url).pathname;const m=request.method;
  try {
    if(p==='/health'&&m==='GET')return json({ok:true,service:'AutoPost Personal 1.2 / Cloudflare',bridge:'outbound-only',zalo:'not-connected-by-default'});
    if(!env.DB) return fail(503,'Chưa cấu hình D1');
    if(p.startsWith('/api/admin/') || (!p.startsWith('/api/')&&p!='/favicon.ico')){
      if(!await adminAuth(request,env))return authChallenge();
    }else if(p.startsWith('/api/')){
      if(!await bridgeAuth(request,env))return unauthorized();
    }
    if(!p.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(m==='GET'&&p==='/api/admin/status'){
      const counts=(await env.DB.prepare('SELECT status,COUNT(*) n FROM jobs GROUP BY status').all()).results||[];
      const host=await env.DB.prepare("SELECT * FROM workers WHERE id='enzonic'").first();
      const zalo=await env.DB.prepare("SELECT * FROM workers WHERE id='zalo'").first();
      const ex=await env.DB.prepare('SELECT * FROM clients ORDER BY last_seen DESC LIMIT 1').first();
      return json({server:'online',hosting:{...host,online:host?now()-host.last_seen<90:false},zalo:{...zalo,online:zalo?now()-zalo.last_seen<90:false},extension:ex?{...ex,capabilities:parse(ex.capabilities,[]),online:now()-ex.last_seen<90}:null,
        counts:Object.fromEntries(counts.map(x=>[x.status,x.n])),integrations:{zalo_reader:false,shopee_converter:false,zalo_sender:false},sending_enabled:env.ENABLE_ZALO_SENDING==='1'});
    }
    if(m==='GET'&&p==='/api/admin/jobs'){
      const rows=(await env.DB.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').all()).results;
      return json({jobs:rows.map(r=>({...r,payload:parse(r.payload,{}),output:parse(r.output)}))});
    }
    if(m==='POST'&&p==='/api/admin/jobs'){
      const b=await body(request);if(!['ping','convert_links'].includes(b.type))return fail(422,'Loại Job không hợp lệ');
      const links=b.links||[];if(!Array.isArray(links)||links.length>20||!links.every(v=>typeof v==='string'&&validURL(v)))return fail(422,'URL HTTPS không hợp lệ');
      if((b.type==='ping'&&links.length)||(b.type==='convert_links'&&!links.length))return fail(422,'Thiếu hoặc thừa danh sách link');
      const job=id();await env.DB.prepare('INSERT INTO jobs(id,type,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(job,b.type,JSON.stringify(b.type==='ping'?{message:'Ping Cloudflare ↔ Extension'}:{links}), 'queued',now(),now()).run();
      return json({id:job,status:'queued'},201);
    }
    if(m==='POST'&&/^\/api\/admin\/jobs\/[^/]+\/retry$/.test(p)){
      const j=p.split('/')[4];const q=await env.DB.prepare("UPDATE jobs SET status='queued',attempts=0,output=NULL,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('error','unsupported')").bind(now(),j).run();return q.meta.changes?json({ok:true}):fail(409,'Job không thể thử lại');
    }
    if(m==='POST'&&p==='/api/bridge/heartbeat'){
      const b=await body(request);if(!okid(b.client_id,80))return fail(422,'Thiếu client_id');
      await env.DB.prepare('INSERT INTO clients(id,version,capabilities,last_seen) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,capabilities=excluded.capabilities,last_seen=excluded.last_seen').bind(b.client_id,String(b.version||'1').slice(0,40),JSON.stringify(Array.isArray(b.capabilities)?b.capabilities.slice(0,15):[]),now()).run();return json({ok:true,server_time:now()});
    }
    if(m==='POST'&&p==='/api/bridge/jobs/claim'){
      const b=await body(request);if(!okid(b.client_id,80))return fail(422,'Thiếu client_id');const n=now();
      await env.DB.prepare("UPDATE jobs SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='leased' AND lease_until<? AND attempts<3").bind(n,n).run();
      await env.DB.prepare("UPDATE jobs SET status='error',error='Quá 3 lần timeout',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='leased' AND lease_until<? AND attempts>=3").bind(n,n).run();
      const row=await env.DB.prepare("SELECT id,type,payload FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").first();if(!row)return json({job:null});
      const token=id();const upd=await env.DB.prepare("UPDATE jobs SET status='leased',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND status='queued'").bind(token,n+120,n,row.id).run();
      return json({job:upd.meta.changes?{id:row.id,type:row.type,payload:parse(row.payload,{}),lease_token:token}:null});
    }
    const matchComplete=p.match(/^\/api\/bridge\/jobs\/([^/]+)\/complete$/);
    if(m==='POST'&&matchComplete){
      const b=await body(request);if(!okid(b.lease_token,100)||!['success','unsupported','error'].includes(b.result))return fail(422,'Kết quả không hợp lệ');
      const row=await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(matchComplete[1]).first();
      if(!row||row.status!=='leased'||row.lease_until<now()||!await secretEqual(row.lease_token,b.lease_token))return fail(409,'Lease không hợp lệ');
      const result={success:'done',unsupported:'unsupported',error:'error'}[b.result],output=b.output&&typeof b.output==='object'?b.output:{};
      const updated=await env.DB.prepare('UPDATE jobs SET status=?,output=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status=? AND lease_token=?').bind(result,JSON.stringify(output),String(b.error||'').slice(0,500),now(),row.id,'leased',b.lease_token).run();
      if(!updated.meta.changes)return fail(409,'Lease đã thay đổi');
      const sources=(await env.DB.prepare('SELECT * FROM source_messages WHERE conversion_job_id=?').bind(row.id).all()).results;
      for(const src of sources){
        const sourceUrls=linksIn(src.text).filter(isShopee);const map=result==='done'?validateConversion(sourceUrls,output.convertedLinks):null;
        if(!map){await env.DB.prepare("UPDATE deliveries SET state='conversion_blocked',error='Shopee chưa chuyển đổi đầy đủ',updated_at=? WHERE msg_key=? AND state='waiting_conversion'").bind(now(),src.msg_key).run();}
        else{await env.DB.prepare("UPDATE deliveries SET state='queued',text=?,error=NULL,updated_at=? WHERE msg_key=? AND state='waiting_conversion'").bind(replaceLinks(src.text,map),now(),src.msg_key).run();}
      }
      return json({ok:true,status:result});
    }
    if(m==='POST'&&p==='/api/host/heartbeat'){
      const b=await body(request);if(!okid(b.id||'enzonic',80))return fail(422,'Worker ID không hợp lệ');
      await env.DB.prepare('INSERT INTO workers(id,kind,status,detail,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,detail=excluded.detail,last_seen=excluded.last_seen').bind('enzonic','bridge',String(b.status||'online').slice(0,50),String(b.detail||'Python outbound bridge; Zalo chưa tích hợp').slice(0,250),now()).run();
      return json({ok:true,server_time:now()});
    }
    if(m==='GET'&&p==='/api/host/config'){
      const total=await env.DB.prepare('SELECT COUNT(*) n FROM rules WHERE enabled=1').first();
      return json({ok:true,configured_rules:total?.n||0,sending_enabled:env.ENABLE_ZALO_SENDING==='1',zalo_integration:'not_installed',shopee_converter:'not_installed'});
    }
    if(m==='POST'&&p==='/api/zalo/heartbeat'){
      const b=await body(request);await env.DB.prepare('INSERT INTO workers(id,kind,status,detail,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,detail=excluded.detail,last_seen=excluded.last_seen').bind('zalo','zalo',String(b.status||'unknown').slice(0,50),String(b.detail||'').slice(0,250),now()).run();return json({ok:true});
    }
    if(m==='POST'&&p==='/api/zalo/groups'){
      const b=await body(request);if(!Array.isArray(b.groups)||b.groups.length>1000)return fail(422,'Danh sách nhóm không hợp lệ');
      const stmts=[];for(const g of b.groups){if(!okid(g.id,120)||!okid(g.name,250))return fail(422,'Nhóm không hợp lệ');stmts.push(env.DB.prepare('INSERT INTO groups(id,name,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at').bind(g.id,g.name,now()));}
      if(stmts.length)await env.DB.batch(stmts);return json({ok:true,count:stmts.length});
    }
    if(m==='GET'&&p==='/api/admin/zalo/overview'){
      const [g,r,d]=await Promise.all([
        env.DB.prepare('SELECT id,name FROM groups ORDER BY name LIMIT 1000').all(),
        env.DB.prepare('SELECT * FROM rules ORDER BY id DESC').all(),
        env.DB.prepare('SELECT id,dest_id,state,error,created_at,updated_at,sent_at,verified_at FROM deliveries ORDER BY created_at DESC LIMIT 60').all()
      ]);
      return json({groups:g.results,rules:r.results,deliveries:d.results,sending_enabled:env.ENABLE_ZALO_SENDING==='1',qr_ready:false,warning:'Zalo QR Worker chưa tích hợp với Enzonic Python; chưa thể nhận/gửi tin thật.'});
    }
    if(m==='POST'&&p==='/api/admin/zalo/rules'){
      const b=await body(request);if(!okid(b.source_id)||!okid(b.dest_id)||b.source_id===b.dest_id)return fail(422,'Nhóm nguồn/đích không hợp lệ');
      const g=(await env.DB.prepare('SELECT id FROM groups WHERE id IN (?,?)').bind(b.source_id,b.dest_id).all()).results;
      if(g.length!==2)return fail(422,'Nhóm chưa được đồng bộ');
      try{const result=await env.DB.prepare('INSERT INTO rules(source_id,dest_id,only_shopee,block_external,enabled) VALUES(?,?,?,?,0)').bind(b.source_id,b.dest_id,b.only_shopee===false?0:1,b.block_external===false?0:1).run();return json({id:result.meta.last_row_id,enabled:false},201);}
      catch{return fail(409,'Quy tắc đã tồn tại');}
    }
    const st=p.match(/^\/api\/admin\/zalo\/rules\/(\d+)\/state$/);
    if(m==='POST'&&st){const b=await body(request);if(typeof b.enabled!=='boolean')return fail(422,'enabled phải true/false');const x=await env.DB.prepare('UPDATE rules SET enabled=? WHERE id=?').bind(b.enabled?1:0,+st[1]).run();return x.meta.changes?json({ok:true}):fail(404,'Không có rule');}
    const del=p.match(/^\/api\/admin\/zalo\/rules\/(\d+)\/delete$/);
    if(m==='POST'&&del){await env.DB.prepare('DELETE FROM rules WHERE id=?').bind(+del[1]).run();return json({ok:true});}
    if(m==='POST'&&p==='/api/zalo/events'){
      const b=await body(request);if(!okid(b.source_id)||!okid(b.message_id,200)||typeof b.text!=='string'||!b.text.trim()||b.text.length>15000)return fail(422,'Tin nhắn không hợp lệ');
      if(b.is_self||b.media)return json({accepted:false,reason:'self_or_media_unsupported'});
      const key=b.source_id+':'+b.message_id,n=now();
      const inserted=await env.DB.prepare('INSERT OR IGNORE INTO source_messages(msg_key,source_id,msg_id,text,created_at) VALUES(?,?,?,?,?)').bind(key,b.source_id,b.message_id,b.text,n).run();
      if(!inserted.meta.changes)return json({accepted:false,reason:'duplicate'});
      const rules=(await env.DB.prepare('SELECT * FROM rules WHERE enabled=1 AND source_id=?').bind(b.source_id).all()).results;
      const {shopee,dests}=chooseDestinations(b.text,rules);
      if(!dests.length)return json({accepted:true,deliveries:0});
      const state=shopee.length?'waiting_conversion':'queued';const inserts=dests.map(dst=>env.DB.prepare('INSERT OR IGNORE INTO deliveries(id,msg_key,dest_id,text,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id(),key,dst,b.text,state,n,n));
      if(inserts.length)await env.DB.batch(inserts);
      if(shopee.length){const job=id();await env.DB.prepare('INSERT INTO jobs(id,type,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(job,'convert_links',JSON.stringify({links:shopee}),'queued',n,n).run();await env.DB.prepare('UPDATE source_messages SET conversion_job_id=? WHERE msg_key=?').bind(job,key).run();}
      return json({accepted:true,deliveries:dests.length,waiting_conversion:!!shopee.length});
    }
    if(m==='POST'&&p==='/api/zalo/send/claim'){
      if(env.ENABLE_ZALO_SENDING!=='1')return json({delivery:null,reason:'sending_disabled'});
      const n=now();await env.DB.prepare("UPDATE deliveries SET state='needs_review',error='Không rõ kết quả sau timeout, không tự gửi lại',lease=NULL,lease_until=NULL,updated_at=? WHERE state='sending' AND lease_until<?").bind(n,n).run();
      const row=await env.DB.prepare("SELECT * FROM deliveries WHERE state='queued' ORDER BY created_at LIMIT 1").first();if(!row)return json({delivery:null});
      const token=id();const upd=await env.DB.prepare("UPDATE deliveries SET state='sending',lease=?,lease_until=?,updated_at=? WHERE id=? AND state='queued'").bind(token,n+90,n,row.id).run();
      return json({delivery:upd.meta.changes?{id:row.id,destination_id:row.dest_id,text:row.text,lease:token}:null});
    }
    const send=p.match(/^\/api\/zalo\/send\/([^/]+)\/complete$/);
    if(m==='POST'&&send){
      const b=await body(request);if(!okid(b.lease,100)||!['accepted','uncertain'].includes(b.result))return fail(422,'Trạng thái gửi không hợp lệ');
      const state=b.result==='accepted'?'awaiting_verification':'needs_review',remote=String(b.remote_message_id||'').slice(0,200);
      const x=await env.DB.prepare('UPDATE deliveries SET state=?,remote_message_id=?,sent_at=?,error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state=\'sending\' AND lease=? AND lease_until>=?').bind(state,remote,b.result==='accepted'?now():null,state==='needs_review'?'Gửi chưa xác minh':null,now(),send[1],b.lease,now()).run();
      return x.meta.changes?json({ok:true,state}):fail(409,'Lease đã hết hạn');
    }
    const verify=p.match(/^\/api\/zalo\/send\/([^/]+)\/verify$/);
    if(m==='POST'&&verify){
      const b=await body(request);if(!['exists','missing','unknown'].includes(b.result))return fail(422,'Kết quả kiểm tra không hợp lệ');
      const row=await env.DB.prepare('SELECT * FROM deliveries WHERE id=?').bind(verify[1]).first();
      if(!row||row.state!=='awaiting_verification'||!row.sent_at||now()-row.sent_at<60)return fail(409,'Chưa đến hạn xác minh 60 giây');
      const state=b.result==='exists'?'verified':b.result==='missing'?'failed':'needs_review';
      await env.DB.prepare('UPDATE deliveries SET state=?,verified_at=?,error=?,updated_at=? WHERE id=? AND state=\'awaiting_verification\'').bind(state,now(),state==='verified'?null:'Không xác minh được tin tồn tại sau 60 giây',now(),row.id).run();
      return json({ok:true,state});
    }
    return fail(404,'Không có API này');
  }catch(e){console.error('AutoPost request failed:',e);return fail(500,detail(e));}
}};
