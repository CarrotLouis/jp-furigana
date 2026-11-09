'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
globalThis.__FURIGANA_PLUS_DICT_LOADER__=p=>fs.promises.readFile(p).then(b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const src=path.resolve(__dirname,'../src'),manifest=require('../src/manifest.json'),core=require('../src/furigana.js'),kuromoji=require('../src/kuromoji.js');
const rows=[{text:'カフェ(cafe)の夢',plain:'カフェの夢',roma:'ka fe no yu me'},{text:'コーヒーとエモーション',plain:'コーヒーとエモーション'},{text:'エモーションエモーションエモーション',plain:'エモーションエモーションエモーション'}];
const tick=()=>new Promise(r=>setTimeout(r,30));async function until(check,label){for(let i=0;i<140;i++){if(check())return;await tick();}throw Error('Timed out: '+label);}
const textOf=node=>{const copy=node.cloneNode(true);for(const n of copy.querySelectorAll('.fg-rt,rt,.rnp-karaoke-word-filler,.fg-hide'))n.remove();return copy.textContent;};
kuromoji.builder({dicPath:path.join(src,'dict')}).build(async(error,tokenizer)=>{
 try {
  if(error)throw error;
  for(const mode of ['native','original','float','slide','slide-noruby']) {
   const karaoke=mode==='float'||mode.startsWith('slide'),wordHTML=t=>[...t].map((c,i)=>`<div class="rnp-karaoke-word" data-time="${i*100}"><span>${c}</span>${mode.startsWith('slide')?`<span class="rnp-karaoke-word-filler">${c}</span>`:''}</div>`).join('');
   const lyrics=mode==='native'?'<ul class="lyric">'+rows.map(r=>`<li class="line"><p>${r.text}</p><p class="translation">保留翻译</p></li>`).join('')+'</ul>':'<div id="rnp-view"><div class="rnp-lyrics">'+rows.map(r=>`<div class="rnp-lyrics-line"><div class="rnp-lyrics-line-${karaoke?'karaoke':'original'}">${karaoke?wordHTML(r.text):r.text}</div><div class="rnp-lyrics-line-translated">保留翻译</div></div>`).join('')+'</div></div>';
   const dom=new JSDOM('<body><div id="root">'+lyrics+'</div><div class="rnp-settings-menu"><div class="rnp-settings-menu-tabs"><div data-tab="lyric"></div></div><div class="rnp-settings-menu-inner"><div class="rnp-group" data-tab="lyric"></div></div></div></body>',{url:'https://music.163.com/',pretendToBeVisual:true,runScripts:'outside-only'}),win=dom.window,handlers={};
   try {
    const file='C:/Test/lyrics/jp-furigana/1.json',record={schema:1,songId:'1',provider:'utaten',url:'https://utaten.com/lyric/test/',title:'試験曲',artists:['試験歌手'],lines:rows.map(r=>({text:r.plain,segments:core.segmentsFromDictionary(tokenizer,r.plain,{inlineRuby:false}).map(({at,...s})=>s)})),userEdits:[]},disk=new Map([[file,JSON.stringify(record)]]),snapshot=JSON.stringify(record.lines);
    win.TextEncoder=TextEncoder;win.document.querySelector('#root').__reactContainer$test={memoizedProps:{store:{getState:()=>({playing:{resourceTrackId:'1',curTrack:{id:1,name:'試験曲',artists:[{name:'試験歌手'}]}},setting:{showLyric:false}}),dispatch(){throw Error('No native action');},subscribe(){}}}};
    win.plugin={pluginPath:src,devMode:false,onLoad:f=>handlers.load=f,onAllPluginsLoaded:f=>handlers.all=f,onConfig:f=>handlers.config=f};win.loadedPlugins={[manifest.slug]:{manifest}};
    win.betterncm={app:{getBetterNCMVersion:async()=>'1.3.4'},ncm:{openUrl(){throw Error('No URL');}},fs:{exists:async()=>true}};win.kuromojiFuriganaPlus={builder:()=>({build:f=>f(null,tokenizer)})};
    win.fetch=async url=>{assert.equal(new URL(url).hostname,'music.163.com');return {ok:true,json:async()=>({lrc:{lyric:rows.map((r,i)=>`[00:0${i+1}]${r.text}`).join('\n')},romalrc:{lyric:'[00:01]ka fe no yu me'}})};};
    win.localStorage.setItem(manifest.slug+'.config',JSON.stringify({readingSource:'dict',externalProvider:'utaten',externalConsent:true,desktopEnabled:false,configVersion:4}));
    win.localStorage.setItem(manifest.slug+'.cache.v9',JSON.stringify(Object.fromEntries(rows.map(r=>['d|hiragana|'+r.text,[{text:r.text}]]))));
    if(mode.endsWith('noruby'))win.localStorage.setItem(manifest.slug+'.no-ruby','1');
    for(const {file:name} of manifest.injects.Main)if(!['kuromoji.js','desktop.js','main.js'].includes(name))win.eval(fs.readFileSync(path.join(src,name),'utf8'));
    win.FuriganaPlusExternal.browserTransport=()=>({dataRoot:async()=>'C:/Test',fs:{mkdir:async()=>true,exists:async p=>disk.has(p),readFileText:async p=>disk.get(p),writeFileText:async(p,v)=>{disk.set(p,v);return true;}},request:async()=>{throw Error('Use the cached record');}});
    win.eval(fs.readFileSync(path.join(src,'main.js'),'utf8'));await handlers.all(win.loadedPlugins);const api=win.JPFuriganaPlus;
    const lines=()=>[...win.document.querySelectorAll(mode==='native'?'li.line>p:first-child':'.rnp-lyrics-line-'+(karaoke?'karaoke':'original'))];
    await until(()=>lines()[0]?.querySelector('.fg-rt'),mode+' initial ruby');assert.equal(win.localStorage.getItem(manifest.slug+'.cache.v9'),null);
    const timing=[...win.document.querySelectorAll('.rnp-karaoke-word')].map(n=>n.dataset.time);
    for(const source of ['dict','romaji']){api.set('readingSource',source);await tick();await tick();assert.equal(textOf(lines()[0]),rows[0].plain);assert([...lines()[0].querySelectorAll('.fg-ruby')].some(n=>textOf(n)==='カフェ'&&n.querySelector('.fg-rt')?.textContent==='cafe'));assert(!lines()[1].querySelector('.fg-rt'));}
    const button=win.document.querySelector('[data-action="edit"]');button.click();await until(()=>win.document.body.classList.contains('fg-edit-mode'),mode+' editing');await tick();
    for(const word of ['コーヒー','エモーション',rows[2].text])assert([...win.document.querySelectorAll('[data-fg-editable]')].some(n=>n.__fgEdit.text===word&&textOf(n)===word),mode+' continuous editable unit: '+word);
    for(const [word,original,value] of [['コーヒー','','Coffee'],['カフェ','cafe','New Word']]) {
     const find=()=>[...win.document.querySelectorAll('[data-fg-editable]')].find(n=>n.__fgEdit?.text===word);
     find().click();const input=win.document.querySelector('[data-reading]');assert.equal(input.value,original);input.value=value;input.dispatchEvent(new win.Event('input',{bubbles:true}));input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
     await until(()=>JSON.parse(disk.get(file)).userEdits.some(e=>e.text===word&&e.reading===value),mode+' saved');await tick();assert(api.readings(rows[word==='コーヒー'?1:0].text).some(s=>s.text===word&&s.rt===value));
     await until(()=>find()?.__fgEdit?.reading===value,mode+' refreshed edit anchor');find().click();win.document.querySelector('[data-restore]').click();await until(()=>{const error=win.document.querySelector('.fg-editor-pop [role=alert]')?.textContent;if(error)throw Error(mode+' restore: '+error);return !JSON.parse(disk.get(file)).userEdits.some(e=>e.text===word);},mode+' restored');await tick();
    }
    assert.equal(JSON.stringify(JSON.parse(disk.get(file)).lines),snapshot);assert.equal(disk.size,1);
    assert.deepEqual([...win.document.querySelectorAll('.rnp-karaoke-word')].map(n=>n.dataset.time),timing);assert([...win.document.querySelectorAll('.translation,.rnp-lyrics-line-translated')].every(n=>n.textContent==='保留翻译'));
    for(const word of win.document.querySelectorAll('.rnp-karaoke-word')){const filler=word.querySelector('.rnp-karaoke-word-filler'),host=word.querySelector('span:not(.rnp-karaoke-word-filler)');if(filler)assert.equal(textOf(filler),textOf(host));}
    api.disable();assert(!win.document.querySelector('.fg-rt,.fg-hide'));lines().forEach((line,i)=>assert.equal(textOf(line),rows[i].text));
   }finally{win.close();}
  }
  console.log('Latin rendering passed: native/RNP original/float/slide/fallback, bare and long katakana editing, English Enter/save/restore, v9 migration, source/offset/timing/filler preservation and disable restoration.');
 }catch(e){console.error(e);process.exitCode=1;}
});
