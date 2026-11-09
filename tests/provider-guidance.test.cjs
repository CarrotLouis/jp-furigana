'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const src=path.resolve(__dirname,'../src'),manifest=require('../src/manifest.json'),plus=manifest.slug.endsWith('-plus');
const ns=plus?'FuriganaPlus':'Furigana',apiName=plus?'JPFuriganaPlus':'JPFurigana',tick=()=>new Promise(r=>setTimeout(r,25));
const text='uta-Net的注音质量较低，建议仅使用UtaTen进行注音';
async function fixture(saved){
 const dom=new JSDOM('<body><div id="root"></div><div class="rnp-settings-menu"><div class="rnp-settings-menu-tabs"><div data-tab="lyric"></div></div><div class="rnp-settings-menu-inner"><div class="rnp-group" data-tab="lyric"></div></div></div></body>',{url:'https://music.163.com/',pretendToBeVisual:true,runScripts:'outside-only'});
 const win=dom.window,handlers={};let requests=0;
 win.plugin={pluginPath:src,devMode:false,onLoad:f=>handlers.load=f,onAllPluginsLoaded:f=>handlers.all=f,onConfig:f=>handlers.config=f};win.loadedPlugins={[manifest.slug]:{manifest}};
 win.betterncm={app:{getBetterNCMVersion:async()=>'1.3.4'},ncm:{openUrl(){throw Error('No external launch');}},fs:{exists:async()=>true}};
 win[plus?'kuromojiFuriganaPlus':'kuromoji']={builder:()=>({build:f=>f(null,{tokenize:()=>[]})})};
 win.fetch=()=>{requests++;throw Error('No network without a track');};
 if(saved)win.localStorage.setItem(manifest.slug+'.config',JSON.stringify(saved));
 for(const {file} of manifest.injects.Main)if(!['kuromoji.js','desktop.js'].includes(file))win.eval(fs.readFileSync(path.join(src,file),'utf8'));
 await handlers.all(win.loadedPlugins);await tick();
 return {win,api:win[apiName],handlers,stored:()=>JSON.parse(win.localStorage.getItem(manifest.slug+'.config')),requests:()=>requests,notice:()=>win.document.querySelector('.fg-provider-notice')};
}
(async()=>{
 let f=await fixture();
 try {
  assert.equal(f.api.config.externalProvider,'utaten');assert(!f.notice());
  f.api.set('readingSource','external');assert.equal(f.api.config.readingSource,'romaji','Consent is still required');
  f.win.document.querySelector('[data-accept]').click();await tick();assert.equal(f.api.config.externalProvider,'utaten');assert.equal(f.api.config.readingSource,'external');
  const panel=f.handlers.config();f.win.document.body.append(panel);
  for(const provider of ['auto','utanet','utaten','auto']) {
   f.api.set('externalProvider',provider);await tick();
   for(const warning of f.win.document.querySelectorAll('[data-provider-warning]')){assert.equal(warning.textContent,text);assert.equal(warning.hidden,provider==='utaten');}
   assert.equal(panel.querySelector('[data-k="externalProvider"]').closest('.fg-row').nextElementSibling.textContent,text);
   assert.equal(f.win.document.querySelector('[data-choice="externalProvider"]').closest('.rnp-select-group-wrapper').nextElementSibling.textContent,text);
   assert(!f.notice(),'Later deliberate provider changes get an inline hint, not a repeated announcement');
  }
 } finally {f.win.close();}
 for(const provider of ['auto','utanet'])for(const useUtaten of [false,true]) {
  f=await fixture({enabled:false,readingSource:'external',externalConsent:true,externalProvider:provider,configVersion:plus?3:4});let stored;
  try {
   assert.equal(f.api.config.externalProvider,provider,'An established preference is unchanged until a button is chosen');
   const notice=f.notice();assert(notice);assert.equal(notice.querySelector('p').textContent,'uta-Net的注音质量较低，建议改为仅使用UtaTen进行注音');const panel=f.handlers.config();f.win.document.body.append(panel);
   const keep=notice.querySelector('[data-keep-provider]'),change=notice.querySelector('[data-use-utaten]');
   assert.equal(keep.textContent,'保持当前选项');assert.equal(change.textContent,'改为使用UtaTen进行注音');
   assert.equal(f.win.getComputedStyle(keep).backgroundColor,'rgb(180, 61, 67)');assert.equal(f.win.getComputedStyle(change).backgroundColor,'rgb(38, 122, 71)');
   (useUtaten?change:keep).click();await tick();assert(!f.notice());
   assert.equal(f.api.config.externalProvider,useUtaten?'utaten':provider);stored=f.stored();assert.equal(stored.externalProviderNoticeSeen,true);assert.equal(f.requests(),0);
   assert.equal(panel.querySelector('[data-k="externalProvider"]').value,stored.externalProvider);assert.equal(f.win.document.querySelector('[data-choice="externalProvider"] .selected').dataset.value,stored.externalProvider);
  } finally {f.win.close();}
  f=await fixture(stored);try {assert(!f.notice(),'The answer survives a restart, including Keep');assert.equal(f.api.config.externalProvider,stored.externalProvider);} finally {f.win.close();}
 }
 f=await fixture({enabled:false,externalProvider:'auto',readingSource:'romaji',externalConsent:false,configVersion:2});try {assert.equal(f.api.config.externalProvider,'utaten','A never-used legacy default gets the new first-use default');assert(!f.notice());}finally{f.win.close();}
 f=await fixture({enabled:false,externalProvider:'utaten',externalConsent:true,configVersion:3});try {assert(!f.notice());assert.equal(f.api.config.externalProvider,'utaten');}finally{f.win.close();}
 console.log('Provider guidance passed: first use/default, legacy preservation, two-button colors/actions, once-only persistence, consent, no network, and synchronized NCM/RNP hints.');
})().catch(e=>{console.error(e);process.exitCode=1;});
