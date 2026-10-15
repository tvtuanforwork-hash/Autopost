import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/index.js';
const env={DB:{},ADMIN_USER:'admin',ADMIN_PASSWORD:'secret-admin-pass',BRIDGE_API_KEY:'secret-bridge-token-not-short'};
test('public health endpoint',async()=>{const r=await api.fetch(new Request('https://example.workers.dev/health'),env);assert.equal(r.status,200);assert.equal((await r.json()).ok,true)});
test('dashboard requires HTTP Basic and does not expose assets',async()=>{
 const r=await api.fetch(new Request('https://example.workers.dev/'),env);assert.equal(r.status,401);assert.ok(r.headers.get('www-authenticate').includes('Basic'));
});
test('api bridge blocks wrong token',async()=>{
 const r=await api.fetch(new Request('https://example.workers.dev/api/host/heartbeat',{method:'POST',headers:{'x-api-key':'wrong'}}),env);
 assert.equal(r.status,401);
});
test('unconfigured DB fails closed',async()=>{
 const r=await api.fetch(new Request('https://example.workers.dev/api/host/heartbeat',{method:'POST'}),{BRIDGE_API_KEY:'x'});
 assert.equal(r.status,503);
});
