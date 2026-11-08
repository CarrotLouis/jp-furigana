'use strict';
const assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const core = require('../src/external-core.js'), { create } = require('../src/external.js');
const lines = ['青い空を見ながら手紙を書いている', '遠い町へ歩いてゆく明日の朝まで', '星の名前を二人で覚えていた夜',
 '静かな川の岸辺で風の音を聞いた', '帰る道を照らした灯りが揺れている', '夢の続きはあの丘の上で待っている'];
const filler = ['知らない歌だけ響いて消えた', '違う名前で別の世界を描いた'];
const html = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row = (id, title = '試験曲', artist = '別の表記') => `<tr><td class="searchResult__title"><a href="/lyric/${id}/">${html(title)}</a></td><td class="searchResult__artist"><p><a>${html(artist)}</a></p></td></tr>`;
const page = (lyrics, title = '試験曲', artist = '別の表記') => `<h2 class="newLyricTitle__main">${html(title)}</h2><h3><a href="/artist/1/">${html(artist)}</a></h3><div class="lyricBody"><div class="hiragana">` + lyrics.map(text => `<span class="ruby"><span class="rb">${html(text[0])}</span><span class="rt">あ</span></span>${html(text.slice(1))}`).join('<br>') + '</div></div>';
const asRecord = lyrics => ({ provider:'utaten', lines:lyrics.map(text=>({text,segments:[{text}]})) });
function fixture(request) {
 const calls = [], files = new Map(), doms = [];
 const client = create({ dataRoot:async()=>'C:/Test', request:async(...args)=>{calls.push(args[0]);return request(...args)},
  parse:text=>{const d=new JSDOM(text);doms.push(d);return d.window.document},
  fs:{mkdir:async()=>true,exists:async p=>files.has(p),readFileText:async p=>files.get(p),writeFileText:async(p,v)=>{files.set(p,v);return true}} });
 return {client,calls,files,close(){client.stop();for(const d of doms)d.window.close()}};
}
const settings = {externalProvider:'utaten',externalAutoRetry:'off'};
const metadata = async()=>({title:'試験曲',artists:['試験歌手'],lyrics:lines});
(async()=>{
 for(const [local,remote] of [["Angel’s Fake","Angel's Fake"],['know me...','know me…'],['secret base 〜君がくれたもの〜 (10 years after Ver.)','secret base ~君がくれたもの~(10 years after Ver.)'],['HIP -Japanese ver.-','HIP-Japanese ver.-']])assert.equal(core.titleKey(local),core.titleKey(remote));
 for(const note of ['大成建設TVCMソング','YOASOBI 18祭','オンラインRPGのコラボソング'])assert.equal(core.titleKey('試験曲('+note+')'),core.titleKey('試験曲'));
 assert.notEqual(core.titleKey('PRAY.'),core.titleKey('Pray'));assert.notEqual(core.titleKey('Pray (Reprise)'),core.titleKey('Pray'));
 assert(core.matches({title:'試験曲',artists:['役名(CV.茅野愛衣)']},{title:'試験曲',artists:['茅野愛衣']}));
 assert(!core.matches({title:'試験曲',artists:['山田太郎']},{title:'試験曲',artists:['山田']}));
 const a = asRecord([...lines.slice(0,4),...filler]), b = asRecord([...lines.slice(0,5),filler[0]]);
 assert(core.lyricEvidence(lines,a).accepted);assert(core.lyricEvidence(lines,b).score>core.lyricEvidence(lines,a).score);
 assert(!core.lyricEvidence(lines,b).complete);assert(core.lyricEvidence(lines,asRecord([lines.join('')])).complete,'Line wrapping does not change full lyrics');
 const variantLocal=['戀人の聲を聞いて歸る時が来た','彈けた風を見て語り合う夢だった'];
 const variantRemote=['恋人の声を聞いて帰る時が来た','弾けた風を見て語り合う夢だった'];
 assert(core.lyricEvidence(variantLocal,asRecord(variantRemote)).complete,'Known kanji variants share a comparison form');
 assert(!core.lyricEvidence([...lines,lines[0]],asRecord(lines)).complete,'Repeated verses must not disappear from full equality');
 assert(!core.lyricEvidence([lines[0]+'(遠く)',...lines.slice(1)],asRecord(lines)).complete,'A vocal repeat is not a reading note');
 const notes={provider:'utaten',lines:[{text:'君と帰る青い道を歩いて',segments:[{text:'君',rt:'きみ'},{text:'と'},{text:'帰',rt:'かえ'},{text:'る青い道を歩いて'}]},
  {text:lines[2],segments:[{text:lines[2]}]}]};
 assert(core.lyricEvidence(['君(きみ)と帰(かえ)る青い道を歩いて',lines[2]],notes).complete,'Explicit notes need matching website ruby before short circuit');
 assert(!core.lyricEvidence(['君(ああ)と帰(かえ)る青い道を歩いて',lines[2]],notes).complete,'An unproven possible chorus cannot trigger a full match');

 const ranked=fixture(async url=>url.includes('/search')?(url.includes('artist_name=')?'<table></table>':'<table>'+row('short')+row('better')+'</table>'):page(url.includes('/short/')?a.lines.map(l=>l.text):b.lines.map(l=>l.text)));
 await ranked.client.load('1',metadata,settings);assert.equal(ranked.client.inspect().url,'https://utaten.com/lyric/better/');assert(ranked.calls.some(u=>u.includes('/short/'))&&ranked.calls.some(u=>u.includes('/better/')));ranked.close();

 const complete=fixture(async url=>{
  if(url.includes('/search'))return url.includes('artist_name=')?'<table></table>':'<link rel="next" href="/search?title='+encodeURIComponent('試験曲')+'&page=2"><table>'+row('complete')+row('unneeded')+'</table>';
  return page(lines);
 });
 await complete.client.load('2',metadata,settings);assert.equal(complete.client.inspect().url,'https://utaten.com/lyric/complete/');
 assert(!complete.calls.some(u=>u.includes('page=2')||u.includes('/unneeded/')),'Complete equality short-circuits remaining details and pages');complete.close();

 const partialPages=fixture(async url=>{
  if(url.includes('/search')){if(url.includes('artist_name='))return '<table></table>';return url.includes('page=2')?'<table>'+row('later')+'</table>':'<link rel="next" href="/search?title='+encodeURIComponent('試験曲')+'&page=2"><table>'+row('early')+'</table>'}
  return page(url.includes('/early/')?a.lines.map(l=>l.text):b.lines.map(l=>l.text));
 });
 await partialPages.client.load('3',metadata,settings);assert.equal(partialPages.client.inspect().url,'https://utaten.com/lyric/later/','A partial first-page match cannot exclude a better later-page version');partialPages.close();

 const alias=fixture(async url=>url.includes('/search')?(new URL(url).searchParams.has('body')?'<table>'+row('alias','別の正式名')+'</table>':'<table></table>'):page(lines,'別の正式名'));
 await alias.client.load('4',metadata,settings);assert.equal(alias.client.inspect().url,'https://utaten.com/lyric/alias/');
 assert.equal(alias.calls.filter(u=>new URL(u).searchParams.has('body')).length,1);alias.close();
 const queries=core.lyricSearchQueries(['作詞: 試験', '君(きみ)と帰(かえ)る青い道を歩いて',...lines]);
 assert(queries.length<=6&&queries.length>=2);assert(queries.every(u=>core.allowedURL(u)&&new URL(u).searchParams.get('body').length>=8));assert(!queries.some(u=>decodeURIComponent(u).includes('きみ')));
 const bodyURL=queries[0],term=new URL(bodyURL).searchParams.get('body'),doc=new JSDOM('<link rel="next" href="/search?body='+encodeURIComponent(term)+'&page=2">');
 assert.equal(core.nextUtatenSearchPage(doc.window.document,bodyURL),bodyURL+'&page=2');doc.window.close();
 console.log('Search ranking passed: metadata aliases, whole-song ranking, kanji variants, inline-reading proof, full-match short circuit, pagination and lyric-search fallback.');
})().catch(error=>{console.error(error);process.exitCode=1});
