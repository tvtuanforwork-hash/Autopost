'use strict';
const $=(id)=>document.getElementById(id);
function baseUrl(raw){
 const u=new URL(raw.trim());const loopback=u.hostname==='localhost'||u.hostname==='127.0.0.1';
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&loopback))throw new Error('Server trên Internet bắt buộc HTTPS');
 if(u.username||u.password||u.search||u.hash)throw new Error('URL không được kèm thông tin đăng nhập');
 return u.origin;
}
function state(text){$('status').textContent=text;}
async function check(){
 state('Đang liên lạc Server…');
 try{
  const response=await chrome.runtime.sendMessage({type:'CHECK_NOW'});
  state(response?.ok?'Đã kết nối Server ✓':`Lỗi: ${response?.error||'Không có phản hồi'}`);
 }catch(e){state(`Lỗi: ${e.message}`)}
}
$('saveButton').addEventListener('click',async()=>{
 try{
  const serverUrl=baseUrl($('serverUrl').value);const apiKey=$('apiKey').value.trim();
  if(!apiKey||apiKey.length<20)throw new Error('API Key trống hoặc quá ngắn');
  // Permissions are requested only after the user clicks the button.
  const allowed=await chrome.permissions.request({origins:[`${serverUrl}/*`]});
  if(!allowed)throw new Error('Bạn chưa cấp quyền truy cập Server cho Extension');
  await chrome.storage.local.set({serverUrl,apiKey});
  await check();
 }catch(e){state(e.message)}
});
$('testButton').addEventListener('click',check);
(async()=>{
 const data=await chrome.storage.local.get(['serverUrl','apiKey','lastSuccess','lastError']);
 $('serverUrl').value=data.serverUrl||'';
 $('apiKey').value=data.apiKey||'';
 if(data.lastSuccess)state(`Lần kết nối gần nhất: ${new Date(data.lastSuccess).toLocaleString('vi-VN')}`);
 if(data.lastError)state(`Lỗi gần nhất: ${data.lastError}`);
})();
