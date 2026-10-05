import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl,safePart,filePath,filterItems,mergeItems,csv,formatOf} from '../core.js';
import {scanPage} from '../collector.js';
const item={url:'https://example.com/cat.png',width:800,height:1200,alt:'小猫',kinds:['页面图片'],category:'动物',selected:true,inView:true,sourceTitle:'练习'};
test('URL rejects executable, credential and file schemes',()=>{for(const u of ['javascript:alert(1)','file:///x','https://a:b@example.com/a','data:image/svg+xml;base64,abc'])assert.equal(safeUrl(u),'');assert.equal(safeUrl(item.url),item.url);});
test('Windows filename cannot escape download folders',()=>{assert.equal(safePart('NUL'),'_NUL');assert.ok(!safePart('../../a\\b').includes('/'));assert.match(filePath(item,0,'练习'),/^MAHO 拾图\/练习\/动物\/001-小猫\.png$/);});
test('combined filters keep intended portrait and exclude keywords',()=>{assert.equal(filterItems([item],{unknown:false,minW:500,ratio:'portrait',category:'动物',query:'小猫',onlySelected:true}).length,1);assert.equal(filterItems([item],{exclude:'广告,小猫'}).length,0);assert.equal(filterItems([item],{minLong:1500}).length,0);});
test('unknown dimensions require explicit inclusion',()=>{const i={...item,width:0,height:0};assert.equal(filterItems([i],{unknown:false}).length,0);assert.equal(filterItems([i],{unknown:true,minW:1000}).length,1);});
test('rescan retains selection and category without URL duplicates',()=>{const merged=mergeItems([item],[{...item,category:'未分类',selected:false,kinds:['候选大图']}]);assert.equal(merged.length,1);assert.equal(merged[0].category,'动物');assert.equal(merged[0].selected,true);assert.equal(merged[0].kinds.length,2);});
test('CSV escapes spreadsheet formulas and quotes',()=>{assert.ok(csv([['=SUM(1)','a"b']]).includes('"\'=SUM(1)"'));assert.ok(csv([['a"b']]).includes('a""b'));});
test('formats are conservative URL hints',()=>{assert.equal(formatOf('https://x.test/image?fm=jpeg'),'jpg');assert.equal(formatOf('https://x.test/image'),'unknown');});
test('collector reads candidates, deduplicates and enforces original origin',()=>{
 globalThis.location={origin:'https://example.com',href:'https://example.com/page'};globalThis.innerWidth=1000;globalThis.innerHeight=800;
 const attrs={src:'/cat.png',srcset:'/cat.png 800w, /large.png 1600w','data-src':'/lazy.webp'};
 const img={tagName:'IMG',localName:'img',src:item.url,currentSrc:item.url,naturalWidth:800,naturalHeight:1200,alt:'小猫',getAttribute:k=>attrs[k],closest:()=>null,getBoundingClientRect:()=>({width:100,height:200,top:0,left:0,bottom:200,right:100})};
 globalThis.document={title:'练习',baseURI:location.href,images:[img,img],querySelectorAll:()=>[img,img]};
 const data=scanPage({origin:location.origin});assert.equal(data.items.length,3);assert.equal(data.items[0].width,800);assert.equal(data.items.find(i=>i.url.endsWith('large.png')).hint,1600);assert.equal(scanPage({candidates:false}).items.length,1);assert.throws(()=>scanPage({origin:'https://other.test'}));
});
