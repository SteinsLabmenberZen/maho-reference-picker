import test from 'node:test';
import assert from 'node:assert/strict';
test('Worker supports authorized multi-page capture, serialized inbox and rejects spoofed messages', async () => {
  const local={}, session={}, created=[], listeners={};
  const storage = values => ({
    async get(keys){if(keys===null)return {...values};const list=Array.isArray(keys)?keys:[keys];return Object.fromEntries(list.filter(k=>k in values).map(k=>[k,structuredClone(values[k]) ]));},
    async set(update){Object.assign(values,structuredClone(update));},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete values[key];}
  });
  globalThis.chrome={
    runtime:{id:'test-extension',getURL:file=>'chrome-extension://test-extension/'+file,onInstalled:{addListener:f=>listeners.install=f},onMessage:{addListener:f=>listeners.message=f}},
    storage:{session:storage(session),local:storage(local)},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},
    contextMenus:{async removeAll(cb){cb?.();},create(){},onClicked:{addListener:f=>listeners.context=f}},
    tabs:{async get(id){return {id,url:'https://site'+id+'.test/gallery',title:'Page '+id};},async create(tab){created.push(tab);return tab;}},
    scripting:{async executeScript({target,args}){if(target.tabId===3)throw new Error('permission denied');return [{result:{page:'https://site'+target.tabId+'.test/gallery',title:'Page '+target.tabId,items:[{url:'https://cdn.test/'+target.tabId+'.png',kinds:['页面图片']}],scannedAt:'now'}}];}}
  };
  await import('../background.js?test');
  const trusted={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
  const content={id:'test-extension',url:'https://site.test/gallery',tab:{id:1,url:'https://site.test/gallery',title:'来源'}};
  const send=(message,sender=trusted)=>new Promise(resolve=>{const result=listeners.message(message,sender,resolve);if(result!==true)resolve(undefined);});
  assert.equal(await send({type:'capture-tabs',tabIds:[1]},{id:'other',url:trusted.url}),undefined);
  assert.equal(await send({type:'capture-tabs',tabIds:[1]},content),undefined);
  assert.equal((await send({type:'capture-tabs',tabIds:[1,2,3]})).ok,true);
  const captured=Object.values(session)[0];
  assert.equal(captured.sources.length,2);assert.equal(captured.items.length,2);assert.equal(captured.errors.length,1);assert.ok(created[0].url.includes('picker.html?capture='));
  const responses=await Promise.all([send({type:'quick-add',item:{url:'https://cdn.test/a.png'}},content),send({type:'quick-add',item:{url:'https://cdn.test/b.png'}},content)]);
  assert.ok(responses.every(r=>r.ok));assert.equal(local.inbox.length,2);
  assert.equal((await send({type:'quick-add',item:{url:'https://cdn.test/a.png'}},content)).result.duplicate,true);
  assert.equal(local.inbox.length,2);assert.equal(local.inbox[0].sourcePage,'https://site.test/gallery');
  assert.equal((await send({type:'quick-add',item:{url:'javascript:alert(1)'}},content)).ok,false);
  assert.equal((await send({type:'open-inbox'})).ok,true);
  assert.equal((await send({type:'clear-inbox'})).ok,true);assert.equal(local.inbox.length,0);
  assert.equal((await send({type:'open-inbox'})).ok,false);
});
