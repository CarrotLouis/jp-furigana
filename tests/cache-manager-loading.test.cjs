'use strict';
const assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{install}=require('../src/editor.js');
const dom=new JSDOM('<body><button id="previous">设置入口</button></body>',{pretendToBeVisual:true}),win=dom.window,doc=win.document;
const tick=()=>new Promise(r=>setTimeout(r,0)),defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const requests=[],reads=[],previews=[];
const row=(songId,title,edits=0,artist='歌手A')=>({songId,title,edits,artists:[artist],bytes:1024,path:'C:/Test/'+songId+'.json'});
const first=[row('1','星の歌',1),row('2','星空',0,'歌手B'),row('3','青い空',2),row('4','雨',0,'歌手C')];
const editor=install({songId:()=> '1',changed(){},list:()=>{const r=defer();requests.push(r);return r.promise;},
 manage:()=>{const r=defer();reads.push(r);return r.promise;},preview:()=>{const r=defer();previews.push(r);return r.promise;}},doc);
const manager=()=>doc.querySelector('.fg-cache-manager'),titles=()=>[...manager().querySelectorAll('.fg-cache-info')].map(n=>n.firstChild.textContent);
const query=value=>{const input=manager().querySelector('[data-search]');input.value=value;input.dispatchEvent(new win.Event('input'));};
const modified=value=>{const input=manager().querySelector('[data-modified]');input.checked=value;input.dispatchEvent(new win.Event('change'));};
const refresh=()=>manager().querySelector('[data-refresh]').click();
const finish=async(index,rows,dir='C:/Test')=>{requests[index].resolve({rows,dir});await tick();};
const ready=()=>assert(!manager().querySelector('[data-summary]').textContent.includes('读取本地缓存'));
(async()=>{
 editor.openManager();assert.equal(requests.length,1);
 query('不存在');modified(true);query('星');
 assert.equal(requests.length,1,'Typing/filtering must not restart the scan');
 assert(manager().querySelector('[data-summary]').textContent.includes('读取本地缓存'),'A pending first load must stay visibly pending');
 assert(!manager().textContent.includes('没有符合条件'),'Do not report an empty cache before the first scan finishes');
 await finish(0,first);ready();assert.deepEqual(titles(),['星の歌'],'Apply the latest query AND modified filter to the incoming result');
 assert(manager().querySelector('[data-summary]').textContent.includes('4 首'));
 query('');assert.deepEqual(titles(),['星の歌','青い空']);modified(false);assert.equal(titles().length,4);

 // Refresh keeps the last snapshot searchable and applies the latest filters
 // to the new snapshot; none of those UI actions invalidate its read.
 refresh();query('新');modified(true);assert.equal(requests.length,2);
 assert(manager().querySelector('[data-summary]').textContent.includes('读取本地缓存'));
 const next=[row('5','新星',1),row('6','新曲',0),row('7','別の曲',1)];await finish(1,next);ready();assert.deepEqual(titles(),['新星']);

 refresh();refresh();assert.equal(requests.length,4);modified(false);query('最新');
 await finish(3,[row('8','最新曲',1),row('9','最新歌',0)]);assert.deepEqual(titles(),['最新曲','最新歌']);
 await finish(2,[row('10','過期結果',1)],'C:/Obsolete');assert.deepEqual(titles(),['最新曲','最新歌'],'An older refresh cannot overwrite the newest result');assert(!manager().textContent.includes('C:/Obsolete'));
 refresh();refresh();await finish(5,[row('11','最新成功',1)]);requests[4].reject(Error('old failure'));await tick();
 assert.deepEqual(titles(),['最新成功']);assert.equal(manager().querySelector('[role=alert]').textContent,'','An older failure cannot overwrite current success');ready();

 refresh();query('成功');modified(true);requests[6].reject(Error('read failed'));await tick();ready();
 assert.deepEqual(titles(),['最新成功'],'A current read failure preserves the last good snapshot');assert.equal(manager().querySelector('[role=alert]').textContent,'read failed');
 refresh();query('');modified(false);await finish(7,first);assert.equal(manager().querySelector('[role=alert]').textContent,'');

 // Filters still invalidate stale detail/preview work. Only the directory scan
 // has a separate lifetime; removing all invalidation would regress this.
 manager().querySelector('.fg-cache-row button').click();assert.equal(reads.length,1);query('青い');
 reads[0].resolve({title:'old details',lines:[],userEdits:[]});await tick();assert.equal(previews.length,0);assert.deepEqual(titles(),['青い空']);
 manager().querySelector('.fg-cache-row button').click();reads[1].resolve({title:'old preview',provider:'local',lines:[],userEdits:[]});await tick();assert.equal(previews.length,1);
 modified(false);query('雨');previews[0].resolve({original:[],corrected:[],separate:[]});await tick();assert(!manager().querySelector('.fg-cache-details'));assert.deepEqual(titles(),['雨']);

 refresh();manager().querySelector('[data-close]').click();editor.openManager();assert.equal(requests.length,10);const current=manager();query('星');modified(true);
 await finish(8,[row('12','old closed manager',1)]);assert.equal(manager(),current);assert(manager().querySelector('[data-summary]').textContent.includes('读取本地缓存'));
 await finish(9,first);assert.deepEqual(titles(),['星の歌']);ready();
 refresh();editor.destroy();requests[10].reject(Error('closed failure'));await tick();assert(!manager(),'Late failures cannot resurrect a destroyed manager');
 console.log('Cache manager loading passed: search/modified changes during initial load and refresh, no extra scans or premature empty state, newest refresh wins, stale failure/detail/preview guards, failure recovery, close/reopen and destroy.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{editor.destroy();win.close();});
