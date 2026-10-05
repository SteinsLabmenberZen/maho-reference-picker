import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {makeZip, crc32, imageType, fetchImage} from '../zip.js';
import {downloadPath, safeName} from '../naming.js';
import {nextZoom} from '../zoom.js';
import {scanPage} from '../collector.js';

test('ZIP uses UTF-8 names, valid CRCs and exact original bytes', async () => {
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
  const zip = new Uint8Array(await (await makeZip([{name:'动物/猫.png',data:bytes},{name:'来源.json',data:new TextEncoder().encode('{"来源":"测试"}')}])).arrayBuffer());
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0,true),0x04034b50);
  assert.equal(view.getUint16(6,true),0x800);
  assert.equal(view.getUint32(14,true),crc32(bytes));
  const n=view.getUint16(26,true); assert.equal(new TextDecoder().decode(zip.slice(30,30+n)),'动物/猫.png');
  assert.deepEqual(zip.slice(30+n,30+n+bytes.length),bytes);
  const end=zip.length-22;assert.equal(view.getUint32(end,true),0x06054b50);assert.equal(view.getUint16(end+8,true),2);
  assert.equal(view.getUint32(view.getUint32(end+16,true),true),0x02014b50);
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});
test('ZIP rejects traversal and duplicate paths',async()=>{
  await assert.rejects(makeZip([{name:'../secret',data:new Uint8Array()}]));
  await assert.rejects(makeZip([{name:'x',data:new Uint8Array()},{name:'x',data:new Uint8Array()}]));
});
test('Image signatures reject HTML despite an image extension',()=>{
  assert.equal(imageType(new TextEncoder().encode('<html>Login required</html>')),'');
  assert.equal(imageType(new TextEncoder().encode('GIF89a\x00')),'gif');
  assert.equal(imageType(Uint8Array.from([255,216,255,0])),'jpg');
});
test('ZIP fetch handles failed responses, wrong content and stream size limits',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('<html/>',{status:403});
    await assert.rejects(fetchImage('https://example.com/a.jpg'),/403/);
    globalThis.fetch=async()=>new Response('<html/>');
    await assert.rejects(fetchImage('https://example.com/a.jpg'),/未获取到/);
    globalThis.fetch=async()=>new Response(Uint8Array.from([255,216,255,0,1,2,3]));
    await assert.rejects(fetchImage('https://example.com/a.jpg',{maxBytes:4}),/超限/);
    const good=await fetchImage('https://example.com/a.jpg');
    assert.equal(good.ext,'jpg');assert.equal(good.bytes.length,7);
  } finally {globalThis.fetch=original;}
});
test('Filename modes keep downloads inside the requested collection',()=>{
  assert.equal(safeName('NUL'),'_NUL');assert.equal(safeName('..'),'参考图');
  assert.ok(!safeName('../../a\\b\u202etest').includes('/'));
  const item={url:'https://img.test/original-name.webp',sourcePage:'https://art.test/work/3',category:'动物',alt:'小猫'};
  assert.equal(downloadPath(item,0,'练习',{extension:'webp'}),'MAHO 拾图/练习/动物/001-小猫.webp');
  assert.equal(downloadPath(item,0,'练习',{naming:'original',grouping:'site',extension:'webp'}),'MAHO 拾图/练习/art.test/001-original-name.webp');
  assert.equal(downloadPath(item,0,'练习',{grouping:'none'}),'MAHO 拾图/练习/001-小猫');
});
test('Wheel zoom is gradual, reversible and bounded for all delta units',()=>{
  assert.ok(nextZoom(1,-100)>1 && nextZoom(1,-100)<1.1);
  assert.ok(Math.abs(nextZoom(nextZoom(2,-20),20)-2)<1e-12);
  assert.equal(nextZoom(1,99999),1);assert.equal(nextZoom(4,-99999),4);
  assert.ok(nextZoom(2,-3,1)>2);
});
test('Collector includes open Shadow DOM, same-origin frames and linked images',()=>{
  globalThis.location={origin:'https://site.test',href:'https://site.test/page'};
  globalThis.innerWidth=1000;globalThis.innerHeight=800;
  const root={title:'主页面',baseURI:location.href,URL:location.href};
  const frame={title:'子页面',baseURI:'https://site.test/gallery/',URL:'https://site.test/gallery/',location:{origin:location.origin},documentElement:{}};
  const image=(src,doc)=>({localName:'img',tagName:'IMG',currentSrc:new URL(src,doc.baseURI).href,src:new URL(src,doc.baseURI).href,naturalWidth:800,naturalHeight:600,alt:'animal',ownerDocument:doc,getAttribute:()=>null,closest:()=>null});
  frame.querySelectorAll=()=>[image('cat.png',frame)];
  const shadow={querySelectorAll:()=>[image('/shadow.webp',root)]};
  root.querySelectorAll=()=>[{localName:'div',ownerDocument:root,shadowRoot:shadow},{localName:'iframe',ownerDocument:root,contentDocument:frame},{localName:'iframe',ownerDocument:root,contentDocument:null},{localName:'a',href:'https://site.test/full.png',ownerDocument:root,closest:()=>null}];
  globalThis.document=root;
  const result=scanPage({origin:location.origin});
  assert.equal(result.items.length,3);assert.equal(result.shadowRoots,1);assert.equal(result.documents,2);assert.equal(result.blockedFrames,1);
  const child=result.items.find(i=>i.url.endsWith('/gallery/cat.png'));assert.equal(child.sourcePage,frame.URL);assert.equal(child.sourceTitle,'子页面');
});
test('Manifest uses MV3 and only optional broad host permissions',()=>{
  const m=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(m.manifest_version,3);assert.equal(m.action.default_popup,'popup.html');
  assert.ok(!m.host_permissions);assert.ok(!m.content_scripts);
  assert.deepEqual(m.optional_permissions,['tabs']);
  assert.ok(m.content_security_policy.extension_pages.includes("script-src 'self'"));
  assert.ok(!m.content_security_policy.extension_pages.includes('unsafe-eval'));
});
test('UI modules reference existing controls and all local assets exist',()=>{
  for(const [htmlName,jsNames] of [['popup.html',['popup.js']],['picker.html',['picker.js','zoom.js','pack-selected.js','destination.js']]]){
    const html=readFileSync(new URL('../'+htmlName,import.meta.url),'utf8');
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
    for(const name of jsNames){const js=readFileSync(new URL('../'+name,import.meta.url),'utf8');for(const m of js.matchAll(/(?:\$\(|getElementById\()'([^']+)'/g))assert.ok(ids.includes(m[1]),name+': '+m[1]);}
    for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g))if(!m[1].includes(':')&&!m[1].startsWith('#'))assert.doesNotThrow(()=>readFileSync(new URL('../'+m[1],import.meta.url)));
  }
  for(const name of readdirSync(new URL('..',import.meta.url)).filter(n=>n.endsWith('.js'))){
    const js=readFileSync(new URL('../'+name,import.meta.url),'utf8');
    for(const m of js.matchAll(/from ['"](\.\/[^'"]+)['"]/g))assert.doesNotThrow(()=>readFileSync(new URL('../'+m[1],import.meta.url)));
  }
});
