'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
globalThis.__FURIGANA_PLUS_DICT_LOADER__=p=>fs.promises.readFile(p).then(b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const kuromoji=require('../src/kuromoji.js'),core=require('../src/furigana.js'),external=require('../src/external-core.js'),edits=require('../src/user-edits.js'),{create}=require('../src/external.js'),{install}=require('../src/editor.js');
const rows=[
 ['ラリホー(rariho)','ラリホー','ラリホー','rariho','ra ri ho o'],
 ['ポイズン(poison)とエモーション(emotion)','ポイズンとエモーション','ポイズン','poison','po i zu n to e mo o sho n'],
 ['カフェ(cafe)で夢（ゆめ）を見る','カフェで夢を見る','カフェ','cafe','ka fe de yu me wo mi ru'],
 ['ノー-ウェイ(no-way)','ノー-ウェイ','ノー-ウェイ','no-way',null],
 ['エェ（Eh）','エェ','エェ','Eh',null],
 ['ﾎﾟｲｽﾞﾝ （ poison ）','ﾎﾟｲｽﾞﾝ','ﾎﾟｲｽﾞﾝ','poison',null],
 ['カフェ（Ｃａｆｅ）','カフェ','カフェ','Cafe',null],
 ['コーヒー(coffee shop)','コーヒー','コーヒー','coffee shop',null],
];
const visible=s=>s.filter(p=>!p.hidden).map(p=>p.text).join(''),joined=s=>s.map(p=>p.text).join('');
kuromoji.builder({dicPath:path.resolve(__dirname,'../src/dict')}).build(async(error,tokenizer)=>{
 try {
  if(error)throw error;
  const dict=(text,mode='hiragana',raw=false)=>core.segmentsFromDictionary(tokenizer,text,{kana:mode,inlineRuby:!raw});
  for(const [text,plain,word,reading,romaji] of rows)for(const mode of ['hiragana','katakana']) {
   const verify=(result,label)=>{assert(result,label);assert.equal(joined(result),text);assert.equal(visible(result),plain,label);const ruby=result.find(s=>s.text===word);assert.equal(ruby?.rt,reading);assert(ruby.fixed&&ruby.inlineLatin);for(const s of result)if(s.rt&&s.at!==undefined)assert.equal(text.slice(s.at,s.at+s.text.length),s.text);};
   const proof=dict(text,mode,true);verify(dict(text,mode),'Dictionary');
   if(romaji){const official=core.segmentsFromReading(text,core.romajiToKana(romaji),proof,{kana:mode});if(text.startsWith('カフェ(cafe)で'))assert(official,'A matching complete reading must align through both kinds of notes');verify(official||dict(text,mode),'Official or dictionary fallback without gloss pronunciation');assert.equal(core.romajiForLine(new Map([[core.lyricKey(plain),romaji]]),text,proof),romaji);}
   const record={schema:1,songId:'1',provider:'utaten',url:'https://utaten.com/lyric/test/',title:'試験曲',artists:['試験歌手'],lines:[{text:plain,segments:dict(plain,mode,true).map(({at,...s})=>s)}]},snapshot=JSON.stringify(record);
   const result=external.segmentsFor(text,external.prepare(record),mode,null,{proofSegments:proof,reading:romaji&&core.romajiToKana(romaji)});verify(result,'Website');assert.equal(JSON.stringify(record),snapshot);
   for(const provider of ['local','utaten']) {
    const base={...record,provider,url:provider==='local'?'':record.url},anchor=edits.annotate(base,text,result,mode).find(s=>s.text===word).edit;
    const changed=edits.update(base,anchor,'Custom Word'),custom=edits.annotate(changed,text,result,mode).find(s=>s.text===word);
    assert.equal(custom.rt,'Custom Word');assert.equal(custom.originalRt,reading);assert(edits.valid(changed.userEdits[0]));assert.deepEqual(changed.lines,record.lines);
    const restored=edits.update(changed,custom.edit,null);assert.equal(edits.annotate(restored,text,result,mode).find(s=>s.text===word).rt,reading);assert.equal(restored.userEdits.length,0);
   }
  }
  for(const text of ['夢(dream)','かな(kana)','Cafe(cafe)','カフェ(123)','カフェ(cafe','カフェ（君の声）']){assert.equal(core.latinRubyRanges(text).length,0);assert.equal(visible(dict(text)),text);}
  const mixed='カフェ(cafe)で夢(ゆめ)を見る（君の声）',mixedResult=dict(mixed);assert.equal(visible(mixedResult),'カフェで夢を見る（君の声）');for(const word of ['君','声'])assert(mixedResult.some(s=>s.text===word&&s.rt));
  const bare='コーヒーのエモーション',bareSegments=dict(bare);assert(!bareSegments.some(s=>s.rt));assert.deepEqual(bareSegments.filter(s=>s.katakana).map(s=>s.text),['コーヒー','エモーション']);
  const website={schema:1,songId:'1',provider:'utaten',url:'https://utaten.com/lyric/test/',title:'試験曲',artists:[],lines:[{text:bare,segments:[{text:'コーヒー',rt:'こーひー'},{text:'の'},{text:'エモーション',rt:'えもーしょん'}]}]};
  const websiteResult=external.segmentsFor(bare,external.prepare(website),'hiragana');assert(!websiteResult.some(s=>s.rt),'No default ruby on bare katakana, even with website phonetics');
  for(const text of [bare,'ラリホー(rariho)']) {
   const disk=new Map(),file='C:/Test/lyrics/jp-furigana/1.json',deps={dataRoot:async()=>'C:/Test',fs:{mkdir:async()=>true,exists:async p=>disk.has(p),readFileText:async p=>disk.get(p),writeFileText:async(p,v)=>{disk.set(p,v);return true;}},request:async()=>{throw Error('No website');}};
   let client=create(deps);await client.ensureLocal('1',async()=>({title:'試験曲',artists:[]}),{});
   const result=()=>client.fallbackSegments(text,dict(text),'hiragana'),anchor=result().find(s=>s.katakana).edit;
   await client.saveEdit(anchor,'English reading',null,t=>dict(t));assert.equal(result().find(s=>s.katakana).rt,'English reading');client.stop();
   client=create(deps);await client.ensureLocal('1',async()=>{throw Error('Read existing JSON');},{});assert.equal(result().find(s=>s.katakana).rt,'English reading');
   await client.saveEdit(result().find(s=>s.katakana).edit,null,null,t=>dict(t));assert.equal(result().find(s=>s.katakana).rt,text===bare?undefined:'rariho');
   const saved=JSON.parse(disk.get(file));assert.equal(saved.schema,1);assert.deepEqual(saved.lines,[]);assert.deepEqual(saved.userEdits,[]);assert.equal(disk.size,1);client.stop();
  }
  for(const value of ['<b>test</b>','\u0000bad','中文','123','   '])assert.throws(()=>edits.reading(value));
  assert.equal(edits.reading('Ｃａｆｅ'),'Cafe');assert.equal(edits.reading('New reading'),'New reading');
  const dom=new JSDOM('<body><span class="fg-ruby" data-fg-editable>コーヒー</span></body>',{pretendToBeVisual:true});
  try {
   const node=dom.window.document.querySelector('.fg-ruby'),record={songId:'1',provider:'local',url:'',lines:[]};node.__fgEdit=edits.annotate(record,bare,bareSegments,'hiragana')[0].edit;let saved;
   const editor=install({songId:()=> '1',save:async(a,r)=>{saved=edits.update(record,a,r);},changed(){}},dom.window.document);editor.setEnabled(true);node.click();
   const input=dom.window.document.querySelector('[data-reading]');assert.equal(input.value,'');input.value='coffee';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));dom.window.document.querySelector('[data-apply]').click();await new Promise(r=>setTimeout(r,0));assert.equal(saved.userEdits[0].reading,'coffee');editor.destroy();
  }finally{dom.window.close();}
  console.log('Latin inline passed: original English glosses, continuous/small/half-width katakana and hyphens, mixed Japanese notes/backings, official/site priority, bare editable units, English edit/restore/reload, one JSON and safe input.');
 }catch(e){console.error(e);process.exitCode=1;}
});
