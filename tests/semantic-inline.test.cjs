'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
globalThis.__FURIGANA_DICT_LOADER__=p=>fs.promises.readFile(p).then(b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
globalThis.__FURIGANA_PLUS_DICT_LOADER__=globalThis.__FURIGANA_DICT_LOADER__;
const kuromoji=require('../src/kuromoji.js'),core=require('../src/furigana.js'),external=require('../src/external-core.js'),edits=require('../src/user-edits.js');
// Minimal user examples and synthetic edge cases, never full real lyrics.
const rows=[
 ['歔欷(すすりな)く風','歔欷く風','歔欷','すすりな','kyo ki ku ka ze','su su ri na ku ka ze'],
 ['罅裂(ひびわ)れた隙間','罅裂れた隙間','罅裂','ひびわ','ka re tsu re ta su ki ma','hi bi wa re ta su ki ma'],
 ['その背中(せな)を','その背中を','背中','せな','so no se na ka wo','so no se na wo'],
 ['反映(うつ)し出す','反映し出す','反映','うつ','ha n e i shi da su','u tsu shi da su'],
 ['霊(まぼろし)の桜よ','霊の桜よ','霊','まぼろし','re i no sa ku ra yo','ma bo ro shi no sa ku ra yo'],
 ['黄泉の間(あわい)で','黄泉の間で','間','あわい','yo mi no a i da de','yo mi no a wa i de'],
 ['射(う)ち','射ち','射','う','sha chi','u chi'],
 ['恋(あい)を見る','恋を見る','恋','あい','ko i wo mi ru','a i wo mi ru'],
 ['世界(ここ)を見る','世界を見る','世界','ここ','se ka i wo mi ru','ko ko wo mi ru'],
 ['世界（ココ）を見る','世界を見る','世界','ココ','se ka i wo mi ru','ko ko wo mi ru'],
 ['霊　（ ﾏﾎﾞﾛｼ ）の桜よ','霊の桜よ','霊','マボロシ','re i no sa ku ra yo','ma bo ro shi no sa ku ra yo'],
];
const joined=s=>s.map(p=>p.text).join(''),visible=s=>s.filter(p=>!p.hidden).map(p=>p.text).join('');
kuromoji.builder({dicPath:path.resolve(__dirname,'../src/dict')}).build((error,tokenizer)=>{
 try {
  if(error)throw error;
  const dict=(text,mode='hiragana',raw=false)=>core.segmentsFromDictionary(tokenizer,text,{kana:mode,inlineRuby:!raw});
  for(const [text,plain,word,reading,conflicting,correct] of rows)for(const mode of ['hiragana','katakana']) {
   const expected=/[ァ-ヺ]/.test(reading)||mode==='katakana'?core.toKatakana(reading):reading;
   const verify=(segments,label)=>{
    assert(segments,label);assert.equal(joined(segments),text,label+' preserves the original source');assert.equal(visible(segments),plain,label+' hides the entire note');
    const found=segments.find(s=>s.text===word);assert.equal(found?.rt,expected,label+' uses the complete explicit base, not a dictionary suffix');assert(found.fixed);
    for(const s of segments)if(s.rt&&s.at!==undefined)assert.equal(text.slice(s.at,s.at+s.text.length),s.text,label+' preserves UTF-16 offsets');
   };
   const proof=dict(text,mode,true);verify(dict(text,mode),'Dictionary');
   for(const romaji of [conflicting,correct])verify(core.segmentsFromReading(text,core.romajiToKana(romaji),proof,{kana:mode}),'Official: '+romaji);
   assert.equal(core.romajiForLine(new Map([[core.lyricKey(plain),conflicting]]),text,proof),conflicting,'Annotated YRC still resolves the plain LRC reading');
   for(const sourceText of [plain,text]) {
    const source=dict(sourceText,mode,true).map(({at,...s})=>s); // Website parsers store no client offsets.
    const record={schema:1,songId:'1',provider:'utaten',url:'https://utaten.com/lyric/test/',title:'試験曲',artists:['試験歌手'],lines:[{text:sourceText,segments:source}]},snapshot=JSON.stringify(record);
    const result=external.segmentsFor(text,external.prepare(record),mode,null,{proofSegments:proof,reading:core.romajiToKana(conflicting)});verify(result,'Website');assert.equal(JSON.stringify(record),snapshot,'Do not rewrite website text or ruby');
    for(const provider of ['local','utaten']) {
     const base={...record,provider,url:provider==='local'?'':record.url},annotated=edits.annotate(base,text,result,mode),anchor=annotated.find(s=>s.text===word).edit;
     assert.equal(anchor.original,core.toHiragana(reading));
     const changed=edits.update(base,anchor,'よみ'),custom=edits.annotate(changed,text,result,mode).find(s=>s.text===word);
     assert.equal(custom.rt,mode==='katakana'?'ヨミ':'よみ','Manual reading wins');assert.equal(custom.originalRt,expected);
     const restored=edits.update(changed,custom.edit,null);verify(edits.annotate(restored,text,result,mode),'Restore original');assert.deepEqual(restored.userEdits,[]);
     assert.deepEqual(changed.lines,record.lines,'Editing must not change the website block');
    }
   }
  }
  const mixed='霊(まぼろし)と背中(せな)（君の声）へ進む（もう一度）';
  for(const mode of ['hiragana','katakana']) {
   const result=dict(mixed,mode);assert.equal(joined(result),mixed);assert.equal(visible(result),'霊と背中（君の声）へ進む（もう一度）');
   for(const word of ['君','声','一度'])assert(result.some(s=>s.text===word&&s.rt),'Kanji in real backing lyrics still receive ruby');
  }
  for(const [text,romaji] of [
   ['光(ああ)を抱く','hi ka ri wo da ku'],['君（きみと）歌う','ki mi u ta u'],
   ['信じた約束は遠く（遠く）','shi n ji ta ya ku so ku ha to o ku'],
   ['君の声（ラララ）','ki mi no ko e'],['君の声（ナナナ）','ki mi no ko e'],
   ['風の声（オー）','ka ze no ko e'],['あした（もういちど）','a shi ta'],
  ]) {
   assert.equal(visible(dict(text)),text,'Keep ordinary backings in dictionary mode');
   const result=core.segmentsFromReading(text,core.romajiToKana(romaji),dict(text,'hiragana',true));
   assert.equal(visible(result||dict(text)),text,'Missing harmony romaji does not erase its lyrics, including dictionary fallback');
  }
  const echo='霊(まぼろし)の声',result=core.segmentsFromReading(echo,core.romajiToKana('re i ma bo ro shi no ko e'),dict(echo,'hiragana',true));
  assert.equal(visible(result),echo,'Whole-line evidence of both words being sung preserves the parentheses');
  console.log('Semantic inline passed: six reported cases, both kana scripts, special/unknown readings, compound scope, official/website conflicts, original offsets, local/manual/restore priority, plain-LRC aliases, mixed backing lyrics and explicit echoes.');
 }catch(e){console.error(e);process.exitCode=1;}
});
