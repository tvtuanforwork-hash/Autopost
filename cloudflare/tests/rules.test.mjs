import test from 'node:test';
import assert from 'node:assert/strict';
import {linksIn,isShopee,chooseDestinations,validateConversion,replaceLinks} from '../src/rules.js';
test('filter Shopee links and external domains',()=>{
 const a=chooseDestinations('deal https://s.shopee.vn/ABC', [{enabled:1,only_shopee:1,block_external:1,dest_id:'a'}]);
 assert.deepEqual(a.dests,['a']);
 const b=chooseDestinations('https://s.shopee.vn/ABC https://example.com', [{enabled:1,only_shopee:1,block_external:1,dest_id:'a'}]);
 assert.deepEqual(b.dests,[]);
 assert.equal(isShopee('https://fake-shopee.vn.bad.site'),false);
});
test('no dupes + preserve punctuation on replacements',()=>{
 assert.deepEqual(linksIn('https://s.shopee.vn/A, https://s.shopee.vn/A.'),['https://s.shopee.vn/A']);
 const m=validateConversion(['https://s.shopee.vn/A'],[{original:'https://s.shopee.vn/A',affiliate:'https://s.shopee.vn/B'}]);
 assert.equal(replaceLinks('Sale (https://s.shopee.vn/A).',m),'Sale (https://s.shopee.vn/B).');
});
test('fail closed: missing conversion blocks sends',()=>{
 assert.equal(validateConversion(['https://s.shopee.vn/A'],[]),null);
 assert.equal(validateConversion(['https://s.shopee.vn/A'],[{original:'https://s.shopee.vn/A',affiliate:'http://invalid.com'}]),null);
});
