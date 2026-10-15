export function linksIn(text) {
  const list = text.match(/https:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(list.map(u=>u.replace(/[),.!?;\]]+$/g, '')))].slice(0,20);
}
export function isShopee(url) {
  try { const u = new URL(url); return u.protocol==='https:' && (u.hostname==='shopee.vn' || u.hostname.endsWith('.shopee.vn') || u.hostname==='shopee.com' || u.hostname.endsWith('.shopee.com')); }
  catch { return false; }
}
export function validURL(url) { try { const u=new URL(url); return u.protocol==='https:' && Boolean(u.hostname) && url.length<=1024; } catch { return false; } }
export function chooseDestinations(text,rules){
  const links=linksIn(text);const shopee=links.filter(isShopee);
  const dests=[...new Set(rules.filter(r=>r.enabled && (!r.only_shopee || shopee.length>0) && (!r.block_external || links.every(isShopee))).map(r=>r.dest_id))];
  return {links,shopee,dests};
}
export function validateConversion(source,converted){
  if(!Array.isArray(converted))return null;
  const expected=[...new Set(source)]; const mapped=new Map();
  for(const item of converted){
    if(!item || typeof item.original!=='string' || typeof item.affiliate!=='string'||!validURL(item.affiliate)||!expected.includes(item.original)||mapped.has(item.original))return null;
    mapped.set(item.original,item.affiliate);
  }
  if(mapped.size!==expected.length)return null;
  return mapped;
}
export function replaceLinks(text,mapping){return text.replace(/https:\/\/[^\s<>"']+/gi, raw=>{
  const clean=raw.replace(/[),.!?;\]]+$/g,'');return (mapping.get(clean)||clean)+raw.slice(clean.length);
});}
