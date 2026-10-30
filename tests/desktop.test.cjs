'use strict';
const assert=require('node:assert/strict');
const desktop=require('../src/desktop.js'),core=require('../src/furigana.js');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await tick();}throw Error('Desktop wait timed out');}
function fixture({delay=false,fail=false,bridgeAvailable=true}={}){
	const subscribers=new Set(),native=new Set(),callbacks=new Map(),sessions=[],visibility=[],actions=[];
	const config={desktopEnabled:false,desktopInheritStyle:true,desktopFontSize:36,desktopTopmost:true,desktopTranslation:true,enabled:true,rtSize:60,rtOpacity:80,karaoke:true,skipCredits:true,skipNoKanaLines:true};
	let data={songId:'1',playId:'1|play',nativeVisible:true,playing:true,locked:false,title:'試験曲',currentText:'空をみる',
		style:desktop.nativeStyle({lyricFont:'微软雅黑',lyricFontSize:35,lyricMode:'translate',lyricColor:['eeeeee','eeeeee','ffdede','ffb0b0'],lyricOutLine:['999999','cb7474'],lyricFontOutlineEnabled:true,lyricLineMode:1}),
		lines:[{time:1,text:'空をみる',translation:'看天空'},{time:4,text:'町へゆく',translation:'前往小镇'}]},reading='そら',resolutions=0,release;
	const nativeNotify=()=>{for(const fn of native)fn(true);};
	const bridge={appendRegisterCall:(name,scope,fn)=>{const set=callbacks.get(name)||new Set();set.add(fn);callbacks.set(name,set);},removeRegisterCall:(name,scope,fn)=>callbacks.get(name).delete(fn)};
	const existing=()=>{};bridge.appendRegisterCall('PlayProgress','audioplayer',existing);
	const req={c:{original:{exports:{Bridge:bridge}}},m:{unrelated:()=>{throw Error('Do not execute unrelated modules');}}};
	const jsonp=[];jsonp.push=item=>{const id=item[2][0][0];req.c[id]={exports:{}};req.m[id]=item[1][id];item[1][id]({},{},req);};
	const win={webpackJsonp:bridgeAvailable?jsonp:[],setInterval,clearInterval,addEventListener(){},removeEventListener(){}};
	const api={config:()=>config,set:(key,value)=>{config[key]=value;for(const fn of [...subscribers])fn();},
		snapshot:()=>data,subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);},watch:fn=>{native.add(fn);return()=>native.delete(fn);},
		visibility:async(hidden,restore=true)=>visibility.push({hidden,restore}),bounds:value=>config.desktopBounds=value,
		readings:text=>{resolutions++;return[{text:text[0],rt:reading},{text:text.slice(1)}];},
		skip:text=>config.skipCredits&&core.isCreditLine(text)||config.skipNoKanaLines&&!core.hasKana(text),
		action:(type,value)=>{actions.push({type,value});if(type==='close'){data={...data,nativeVisible:false};nativeNotify();}},
		transport:{start:async()=>{
			if(fail)throw Error('模拟组件启动失败');
			const frames=[];let pending,aborted;
			const session={frames,stopped:false,send:async frame=>{frames.push(structuredClone(frame));},events:()=>new Promise((resolve,reject)=>{pending=resolve;aborted=reject;}),
				stop:async()=>{session.stopped=true;if(aborted)aborted(Error('Stopped'));},emit:async event=>{await until(()=>pending);const resolve=pending;pending=null;resolve({events:[event]});}};
			sessions.push(session);if(delay)await new Promise(r=>release=r);return session;
		}}};
	const host=desktop.host(api,win);
	return{api,host,config,sessions,visibility,actions,callbacks,existing,notify:()=>{for(const fn of subscribers)fn();},nativeNotify,
		get data(){return data;},set data(value){data=value;},set reading(value){reading=value;},get resolutions(){return resolutions;},release:()=>release()};
}
(async()=>{
	const settingsCalls=[],menuCallbacks=new Set(),menuBridge={appendRegisterCall:(name,scope,fn)=>{assert.equal(name,'menuclick');assert.equal(scope,'winhelper');menuCallbacks.add(fn);},removeRegisterCall:(name,scope,fn)=>menuCallbacks.delete(fn)};
	const menuRequire={c:{sdk:{exports:{Bridge:menuBridge}}},m:{}},menuJsonp=[];menuJsonp.push=item=>{const id=item[2][0][0];menuRequire.m[id]=item[1][id];item[1][id]({},{},menuRequire);};
	const settingsWindow={webpackJsonp:menuJsonp,setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},document:{querySelector:selector=>{assert.equal(selector,'#rnp-view .rnp-window-tool-plugin-close');return{click:()=>settingsCalls.push('close-rnp')};}},channel:{call:(name,callback,args)=>{assert.deepEqual(args,[]);settingsCalls.push(name);callback();}}};
	const settingsStore={dispatch:action=>settingsCalls.push(action)};desktop.openSettings(settingsStore,settingsWindow);
	assert.deepEqual(settingsCalls,[{type:'setting/handleDesktopLyricAction',payload:{type:'setting'}}],'Gear opens the native menu without leaving RNP');
	for(const fn of [...menuCallbacks])fn('lyricTop');assert.equal(menuCallbacks.size,0);assert.equal(settingsCalls.length,1,'Ordinary menu options keep the playback page');
	desktop.openSettings(settingsStore,settingsWindow);for(const fn of [...menuCallbacks])fn('moreSetting');
	assert.deepEqual(settingsCalls.slice(-2),['close-rnp','winhelper.bringWindowToTop'],'Only native more-settings reveals the main page');assert.equal(menuCallbacks.size,0);
	const fontCalls=[];desktop.setFontSize({getState:()=>({setting:{lyricFont:'默认',lyricFontDefault:'等线',lyricFontStyle:1}}),dispatch:action=>fontCalls.push(action)},40,{channel:{call:(name,cb,args)=>fontCalls.push({name,args})}});
	assert.equal(fontCalls[0].payload.lyricFontSize,40);assert.deepEqual(fontCalls[1],{name:'player.setLRCFont',args:['40','1','等线']},'Wheel updates the original native renderer as well as Redux');
	assert.equal(desktop.nativeStyle({lyricFont:'默认',lyricFontDefault:'等线',lyricFontSize:16}).fontFamily,'等线');assert.equal(desktop.nativeStyle({lyricFontSize:16}).fontSize,16,'Inherit native sizes below the custom slider minimum');
	const yrc='[1500,2000](1500,500,0)空(2000,1000,0)をみる';
	const timed=desktop.attachWords([{time:1,text:'空 をみる'}],yrc,.5)[0];
	assert.deepEqual(timed.words,[{from:0,to:1,start:1,end:1.5},{from:2,to:5,start:1.5,end:2.5}]);assert.equal(desktop.highlightTo(timed,1.4),1);assert.equal(desktop.highlightTo(timed,1.5),5);
	assert(!desktop.attachWords([{time:1,text:'海をみる'}],yrc)[0].words,'Never apply timings to different text');assert(!desktop.attachWords([{time:20,text:'空をみる'}],yrc)[0].words,'Reject distant same-text lines');
	const native={resourceTrackId:'1',offset:.5,lyricLines:[{time:3.5,lyric:'町へゆく'},{time:.5,lyric:'空をみる'},{time:5,lyric:''}],tlyricLines:[{time:1,lyric:'看天空'},{time:4,lyric:'前往小镇'}]};
	const timeline=desktop.nativeTimeline(native,'1');assert.deepEqual(timeline.map(l=>[l.time,l.translation]),[[.5,'看天空'],[3.5,'前往小镇'],[5,'']]);
	assert.equal(desktop.lineAt(timeline,.49),-1);assert.equal(desktop.lineAt(timeline,3.5),1);assert.equal(desktop.lineAt(timeline,5),2);assert.deepEqual(desktop.nativeTimeline(native,'2'),[]);
	assert.equal(native.lyricLines[0].time,3.5,'Never mutate native lyric objects');
	assert.equal(desktop.nativeTimeline({resourceTrackId:'1',lyricLines:[{time:1.1,lyric:'次の声'}],tlyricLines:[{time:1,lyric:'前一句'},{time:1.1,lyric:'下一句'}]},'1')[0].translation,'下一句');
	const yrcOnly=desktop.nativeTimeline({resourceTrackId:'1',lyricLines:[{time:1,lyric:'空をみる'}],yrcInfo:{yrcTrans:'[00:01]看天空',yrcRoma:'[00:01]so ra wo mi ru'}},'1',core.parseLrc)[0];assert.equal(yrcOnly.translation,'看天空');assert.equal(yrcOnly.romaji,'so ra wo mi ru');
	const fallback=desktop.lrcTimeline('[00:01]空をみる\n[00:04]町へゆく','[00:01.05]看天空\n[00:04]前往小镇',core.parseLrc);
	assert.equal(fallback[0].time,1,'Convert API milliseconds into native clock seconds');assert.equal(fallback[0].translation,'看天空');
	const f=fixture();f.host.sync();assert.equal(f.sessions.length,0,'Disabled means no renderer or playback listeners');
	f.api.set('desktopEnabled',true);await until(()=>f.host.inspect().ready);const first=f.sessions[0];
	assert.equal(first.frames[0].fontSize,35,'Inherit original desktop font size');assert.equal(first.frames[0].style.fontFamily,'微软雅黑');
	assert.equal(first.frames[0].style.colorBottom,'#ffb0b0');assert.equal(first.frames[0].translation,'看天空');assert(f.visibility.some(v=>v.hidden));
	f.data={...f.data,style:{...f.data.style,mode:'roman'},lines:[{...f.data.lines[0],romaji:'so ra wo mi ru'},f.data.lines[1]]};f.nativeNotify();await until(()=>first.frames.at(-1).translation==='so ra wo mi ru');f.data={...f.data,style:{...f.data.style,mode:'translate'}};f.nativeNotify();await until(()=>first.frames.at(-1).translation==='看天空');
	const clock=(id,sec)=>{for(const fn of f.callbacks.get('PlayProgress'))fn(id,sec);};
	const before=f.resolutions;clock('1|play',1.2);clock('1|play',1.3);clock('old|play',8);await tick();assert.equal(f.resolutions,before,'Stable lines do not repeatedly tokenize or send frames');
	f.data={...f.data,lines:[{...f.data.lines[0],words:[{from:0,to:1,start:1.4,end:1.8},{from:1,to:4,start:1.8,end:2.4}]},f.data.lines[1]]};f.nativeNotify();await until(()=>first.frames.at(-1).karaoke);
	const cached=f.resolutions;clock('1|play',1.5);await until(()=>first.frames.at(-1).highlightTo===1);clock('1|play',1.9);await until(()=>first.frames.at(-1).highlightTo===4);assert.equal(f.resolutions,cached,'Word highlighting reuses readings');
	f.api.set('rtSize',45);f.api.set('rtOpacity',37);await until(()=>first.frames.at(-1).rtSize===45&&first.frames.at(-1).rtOpacity===37);
	f.api.set('karaoke',false);await until(()=>!first.frames.at(-1).karaoke);const plainFrames=first.frames.length;clock('1|play',2.1);await tick();assert.equal(first.frames.length,plainFrames,'Disabling karaoke stops per-word updates');f.api.set('karaoke',true);
	f.reading='あおぞら';f.notify();await until(()=>first.frames.at(-1).segments[0].rt==='あおぞら');
	clock('1|play',4.2);await until(()=>first.frames.at(-1).translation==='前往小镇');
	for(const fn of f.callbacks.get('Seek'))fn('1|play','seek',0,1);await until(()=>first.frames.at(-1).translation==='看天空');
	f.data={...f.data,locked:true};f.nativeNotify();await until(()=>first.frames.at(-1).locked);
	await first.emit({type:'unlock'});await until(()=>f.actions.some(a=>a.type==='unlock'));
	await first.emit({type:'bounds',value:{x:12,y:34,width:700}});await until(()=>f.config.desktopBounds);assert.equal(f.config.desktopBounds.width,700);
	f.api.set('desktopInheritStyle',false);f.api.set('desktopFontSize',54);f.api.set('desktopTranslation',false);await until(()=>first.frames.at(-1).fontSize===54);assert.equal(first.frames.at(-1).translation,'');
	f.data={...f.data,lines:[{time:1,text:'作詞: 空ゆい子',translation:''}]};f.nativeNotify();clock('1|play',1.1);await until(()=>first.frames.at(-1).segments.map(s=>s.text).join('')==='作詞: 空ゆい子');assert(!first.frames.at(-1).segments.some(s=>s.rt),'Credit skipping must also guard raw dictionary adapters');
	f.api.set('skipCredits',false);await until(()=>first.frames.at(-1).segments.some(s=>s.rt));f.api.set('skipCredits',true);await until(()=>!first.frames.at(-1).segments.some(s=>s.rt));
	f.data={...f.data,songId:'2',playId:'2|play',currentText:'',lines:[]};f.nativeNotify();clock('1|play',90);await until(()=>first.frames.at(-1).message==='暂无歌词');assert.equal(first.frames.at(-1).segments.length,0,'Track changes clear stale text');
	await first.emit({type:'close'});await until(()=>first.stopped);assert(f.config.desktopEnabled,'Closing native lyrics keeps replacement mode for the next native hotkey/open action');assert(f.visibility.some(v=>!v.hidden&&!v.restore));
	f.data={...f.data,nativeVisible:true};f.nativeNotify();await until(()=>f.sessions.length===2&&f.host.inspect().ready);
	f.api.set('desktopEnabled',false);await until(()=>f.sessions[1].stopped);assert(f.visibility.some(v=>!v.hidden&&v.restore),'Disabling replacement restores native lyrics');
	assert.equal(f.callbacks.get('PlayProgress').size,1);assert(f.callbacks.get('PlayProgress').has(f.existing),'Never remove RNP/client callbacks');f.host.dispose();
	const bad=fixture({fail:true});bad.api.set('desktopEnabled',true);await until(()=>!bad.config.desktopEnabled);assert.match(bad.host.inspect().status,/组件启动失败/);assert(!bad.visibility.some(v=>v.hidden));bad.host.dispose();
	const race=fixture({delay:true});race.api.set('desktopEnabled',true);await until(()=>race.sessions.length);race.api.set('desktopEnabled',false);race.release();await until(()=>race.sessions[0].stopped);assert(!race.visibility.some(v=>v.hidden),'Late startup cannot hide the original window');race.host.dispose();
	console.log('Desktop passed: timeline units/offsets, native style inheritance, shared readings, stable-frame caching, seeks, track races, lock/actions, native close/reopen, visibility restore and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
