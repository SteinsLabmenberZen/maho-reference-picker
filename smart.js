import {safeUrl,CATEGORIES} from './core.js';
export function suggestion(item){
 const text=(item.alt||'').toLowerCase();
 const rules=[['头像表情',/头像|表情|\bportrait\b|\bexpression\b/],['动物',/动物|小猫|猫咪|小狗|鸟|兔|狐狸|\b(cat|dog|animal|bird|rabbit|fox|horse)\b/],['人物',/人物|人体|角色|女孩|男孩|\b(character|figure|girl|boy|pose)\b/],['线稿',/线稿|线描|简笔画|\b(lineart|line art|outline)\b/]];
 for(const [category,re] of rules){const match=text.match(re);if(match)return {category,reason:'图片说明：'+match[0]};}return null;
}
export function useful(item){return !item.failed&&item.width>=350&&item.height>=350&&Math.max(item.width,item.height)>=700&&!/avatar|favicon|logo|sprite|二维码|广告/i.test(item.alt+' '+item.url)&&item.width/item.height>.25&&item.width/item.height<4;}
export function imported(data){
 if(!Array.isArray(data?.items)||data.items.length>1500)throw new Error('请选择含 items 数组的来源清单，每批不超过 1500 张。');
 const seen=new Set();return data.items.filter(i=>i&&typeof i.url==='string'&&safeUrl(i.url)&&!seen.has(i.url)&&(seen.add(i.url),true)).map(i=>({url:i.url,width:Math.max(0,Math.min(100000,Number(i.width)||0)),height:Math.max(0,Math.min(100000,Number(i.height)||0)),alt:String(i.alt||'').slice(0,400),sourceTitle:String(i.sourceTitle||'').slice(0,300),sourcePage:safeUrl(i.sourcePage)||'',detailPage:safeUrl(i.detailPage)||'',category:CATEGORIES.includes(i.category)?i.category:'未分类',kinds:['导入清单'],selected:!!i.selected,favorite:!!i.favorite,note:String(i.note||'').slice(0,1000),inView:false}));
}
