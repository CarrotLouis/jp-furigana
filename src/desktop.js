/* Optional desktop lyrics. One small WPF renderer runs only while lyrics are
 * visible; readings, the native playback clock and source caches stay here. */
(function(root,factory){
	if(typeof module==='object'&&module.exports)module.exports=factory();
	else root.FuriganaPlusDesktop=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
	'use strict';
	const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
	function nearest(lines,time,tolerance){let found=null,distance=tolerance;for(const line of lines){const delta=Math.abs(line.time-time);if(delta<distance){found=line;distance=delta;}}return found;}
	function nativeTimeline(lyric,songId){
		if(!lyric||String(lyric.resourceTrackId)!==String(songId)||!Array.isArray(lyric.lyricLines))return [];
		const translations=(lyric.tlyricLines||[]).filter(l=>Number.isFinite(l.time)&&typeof l.lyric==='string');
		return lyric.lyricLines.filter(l=>Number.isFinite(l.time)&&typeof l.lyric==='string').map(l=>{
			const tr=nearest(translations,l.time+(Number(lyric.offset)||0),.001);
			return {time:l.time,text:l.lyric,translation:tr?tr.lyric:''};
		}).sort((a,b)=>a.time-b.time);
	}
	function lrcTimeline(lrc,translated,parse){const trans=parse(translated||'');return parse(lrc||'').map(l=>{const tr=nearest(trans,l.time,250);return {time:l.time/1000,text:l.text,translation:tr?tr.text:''};}).sort((a,b)=>a.time-b.time);}
	function lineAt(lines,seconds){if(!Number.isFinite(seconds))return -1;let lo=0,hi=lines.length;while(lo<hi){const mid=(lo+hi)>>>1;if(lines[mid].time<=seconds)lo=mid+1;else hi=mid;}return lo-1;}
	function findBridge(win){
		// Inspect only cached exports; do not replace the client's event callbacks.
		if(!Array.isArray(win.webpackJsonp))return null;let require;
		const id='jpfg-desktop-'+Date.now();win.webpackJsonp.push([[id],{[id]:(m,e,r)=>{require=r;}},[[id]]]);
		if(!require)return null;
		try{for(const mod of Object.values(require.c||{})){const b=mod.exports&&mod.exports.Bridge;if(b&&typeof b.appendRegisterCall==='function'&&typeof b.removeRegisterCall==='function')return b;}}
		finally{delete require.c[id];delete require.m[id];}return null;
	}
	const color=(value,fallback)=>/^[a-f0-9]{6}$/i.test(String(value||''))?'#'+value:fallback;
	function nativeStyle(s={}){
		const colors=Array.isArray(s.lyricColor)?s.lyricColor:[],outline=Array.isArray(s.lyricOutLine)?s.lyricOutLine:[];
		const align=s.lyricLineMode?['center','center','left','right'][s.lyricOneLineAlign]:['center','left','left','right'][s.lyricDoubleLineAlign];
		return {fontFamily:String(s.lyricFont&&s.lyricFont!=='默认'?s.lyricFont:s.lyricFontDefault||'Microsoft YaHei'),fontSize:clamp(Number(s.lyricFontSize)||36,8,144),bold:Number(s.lyricFontStyle)===1,
			colorTop:color(colors[2],'#ffdede'),colorBottom:color(colors[3],'#ffb0b0'),outline:!!s.lyricFontOutlineEnabled,outlineColor:color(outline[1],'#cb7474'),
			align:align||'center',topmost:s.lyricTop!==false,locked:!!s.desktopLyricLockState,showTranslation:s.lyricMode==='translate',doubleLine:s.lyricLineMode===0,vertical:s.lyricComposition==='vertical'};
	}
	function bounds(value){if(!value||!['x','y','width'].every(k=>Number.isFinite(Number(value[k]))))return null;return {x:clamp(Number(value.x),-50000,50000),y:clamp(Number(value.y),-50000,50000),width:clamp(Number(value.width),240,10000)};}
	function openSettings(store,win=window){
		// Native "more settings" only changes the main-page route. RNP can cover
		// that page, so close its overlay through the existing lifecycle button.
		const button=win.document.querySelector('#rnp-view .rnp-window-tool-plugin-close');if(button)button.click();
		win.channel.call('winhelper.bringWindowToTop',()=>{},[]);
		store.dispatch({type:'@@router/CALL_HISTORY_METHOD',payload:{method:'push',args:[{pathname:'/setting/desklyric/'+Date.now(),state:{}}]}});
	}
	function browserTransport(bn,plugin,win=window){
		const utf8=value=>{let binary='';for(const b of new win.TextEncoder().encode(value))binary+=String.fromCharCode(b);return win.btoa(binary);};
		const command64=value=>{let binary='';for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);binary+=String.fromCharCode(c&255,c>>8);}return win.btoa(binary);};
		return {async start(cancelled=()=>false){
			const exe=plugin.pluginPath.replace(/\\/g,'/')+'/desktop-host.exe';
			if(!await bn.fs.exists(exe))throw Error('缺少桌面歌词组件，请重新安装完整插件包');
			const token=[...win.crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
			const dir=(await bn.app.getDataPath()).replace(/\\/g,'/')+'/lyrics/jp-furigana/desktop';
			if(!await bn.fs.mkdir(dir))throw Error('无法创建桌面歌词运行目录');
			const ready=dir+'/desktop-'+token+'.json',argument=utf8(JSON.stringify({token,ready}));
			// Only the path is quoted into a PowerShell literal; all other arguments
			// are one base64 JSON value, never lyric text or executable expressions.
			const command='powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+command64("Start-Process -WindowStyle Hidden -FilePath '"+exe.replace(/'/g,"''")+"' -ArgumentList '"+argument+"'");
			let endpoint=null,stopped=false;const controllers=new Set();
			async function request(path,data){
				const abort=new win.AbortController();controllers.add(abort);const timer=win.setTimeout(()=>abort.abort(),4000);
				try{const response=await win.fetch(endpoint+path+'?token='+token,{method:data===undefined?'GET':'POST',body:data===undefined?undefined:JSON.stringify(data),headers:data===undefined?{}:{'Content-Type':'application/json'},signal:abort.signal,cache:'no-store',keepalive:path==='/stop'});if(!response.ok)throw Error('桌面歌词连接失败（HTTP '+response.status+'）');return await response.json();}
				finally{win.clearTimeout(timer);controllers.delete(abort);}
			}
			async function stop(){if(stopped)return;stopped=true;for(const c of controllers)c.abort();if(endpoint)try{await request('/stop',{});}catch(_){}for(const file of [ready,ready+'.error'])try{if(await bn.fs.exists(file))await bn.fs.remove(file);}catch(_){} }
			try{
				if(cancelled())throw Error('已取消');if(!await bn.app.exec(command,false,false))throw Error('无法启动桌面歌词组件');
				const deadline=Date.now()+12000;
				while(Date.now()<deadline){
					if(cancelled())throw Error('已取消');
					if(await bn.fs.exists(ready+'.error'))throw Error('桌面歌词启动失败：'+(await bn.fs.readFileText(ready+'.error')).slice(0,300));
					if(await bn.fs.exists(ready)){
						let info;try{info=JSON.parse(await bn.fs.readFileText(ready));}catch(_){await new Promise(r=>win.setTimeout(r,100));continue;}
						if(info.token!==token||info.protocol!==1||!Number.isInteger(info.port)||info.port<1||info.port>65535)throw Error('桌面歌词连接信息无效');
						endpoint='http://127.0.0.1:'+info.port;return {send:frame=>request('/frame',frame),events:()=>request('/events'),stop};
					}
					await new Promise(r=>win.setTimeout(r,100));
				}throw Error('桌面歌词启动超时，请检查 Windows .NET Framework 4.8 或安全软件拦截');
			}catch(error){await stop();throw error;}
		}};
	}
	function host(api,win=window){
		let session=null,starting=false,disposed=false,bridge=null,revision=0,generation=0,timer=null,signature='',status='',ready=false;
		let track='',playId='',position=null,pending=null,sending=false,hidden=false;
		const listeners=[];
		function changed(text){if(status===text)return;status=text;if(api.changed)api.changed();}
		function snapshot(){const data=api.snapshot({needCurrentText:position===null});if(data.songId!==track||data.playId!==playId){track=data.songId;playId=data.playId;position=null;signature='';revision++;}return data;}
		function update(force=false,data=null){
			if(!session||disposed)return;data=data||snapshot();const cfg=api.config(),style=cfg.desktopInheritStyle===false?{}:data.style||{};
			let index=lineAt(data.lines,position);if(position===null&&data.currentText)index=data.lines.findIndex(l=>l.text.trim()===data.currentText.trim());
			const row=index>=0?data.lines[index]:null,next=style.doubleLine&&index+1<data.lines.length?data.lines[index+1]:null;
			const sig=JSON.stringify([track,playId,revision,row,next,cfg.enabled,cfg.kana,cfg.rtSize,cfg.rtOpacity,cfg.desktopFontSize,cfg.desktopTranslation,cfg.desktopTopmost,cfg.desktopBounds,style,data.playing,data.locked]);
			if(!force&&sig===signature)return;signature=sig;
			const readings=text=>cfg.enabled?api.readings(text)||[{text}]:[{text}];const translation=cfg.desktopInheritStyle===false?cfg.desktopTranslation!==false:style.showTranslation!==false;
			pending={segments:row?readings(row.text):[],translation:translation&&row?row.translation:'',fontSize:style.fontSize||cfg.desktopFontSize||36,style,
				rtSize:cfg.rtSize,rtOpacity:cfg.rtOpacity,topmost:style.topmost===undefined?cfg.desktopTopmost!==false:style.topmost,locked:!!data.locked,playing:!!data.playing,bounds:bounds(cfg.desktopBounds),
				next:next?{segments:readings(next.text),translation:translation?next.translation:''}:null,
				message:row?'':!track?'等待播放歌曲':!data.lines.length?'暂无歌词':position===null?'等待播放进度':data.title||'前奏'};
			return drain(generation);
		}
		async function drain(version){if(sending)return;sending=true;try{while(pending&&session&&version===generation){const frame=pending;pending=null;await session.send(frame);}}catch(e){if(version===generation)fail(e);}finally{sending=false;if(pending&&session)drain(generation);}}
		function clock(id,seconds){const data=snapshot();if(String(id)!==data.playId||!Number.isFinite(Number(seconds)))return;position=Number(seconds);update(false,data);}
		async function stop(restore=true){
			generation++;if(timer)win.clearInterval(timer);timer=null;const old=session;session=null;starting=ready=false;pending=null;signature='';track=playId='';position=null;
			for(const [name,fn] of listeners.splice(0))bridge.removeRegisterCall(name,'audioplayer',fn);
			if(hidden){hidden=false;if(api.visibility)try{await api.visibility(false,restore);}catch(_){}}
			if(old)await old.stop();
		}
		async function fail(error){await stop();api.set('desktopEnabled',false);changed(error.message||String(error));}
		async function events(version,active){
			while(!disposed&&version===generation&&session===active){
				try{const reply=await active.events();for(const e of reply.events||[]){if(version!==generation)return;if(e.type==='bounds'){const value=bounds(e.value);if(value&&api.bounds)api.bounds(value);}else if(['translation','offset_back','offset_forward','playprev','play_pause','playnext','setting','lock','unlock','close','fontSize'].includes(e.type)&&api.action)api.action(e.type,e.value);}}
				catch(error){if(version===generation)await fail(error);return;}
			}
		}
		async function open(){
			if(disposed||starting||session)return;starting=true;const version=++generation;changed('正在打开桌面歌词…');
			try{
				bridge=bridge||findBridge(win);if(!bridge)throw Error('未找到播放进度接口，请进入一次播放页后重试');
				const active=await api.transport.start(()=>disposed||version!==generation);
				if(disposed||version!==generation){await active.stop();return;}session=active;
				for(const [name,fn] of [['PlayProgress',clock],['Seek',(id,seekId,code,seconds)=>{if(Number(code)===0)clock(id,seconds);} ]]){bridge.appendRegisterCall(name,'audioplayer',fn);listeners.push([name,fn]);}
				starting=false;await update(true);if(version!==generation)return;ready=true;events(version,active);
				if(api.visibility){hidden=true;await api.visibility(true);}
				if(version!==generation)return;changed('桌面注音已开启');
				timer=win.setInterval(()=>{sync(false);},1000);
			}catch(error){if(version===generation)await fail(error);}
		}
		function sync(invalidate=true){
			if(disposed)return;const cfg=api.config();
			if(!cfg.desktopEnabled||!cfg.enabled){if(session||starting){stop();changed('');}return;}
			const data=snapshot();
			if(cfg.desktopInheritStyle!==false&&data.style&&data.style.vertical){if(session||starting)stop();changed('竖排继续使用原桌面歌词；桌面注音暂支持横排');return;}
			if(data.nativeVisible===false){if(session||starting)stop(false);changed('打开网易云桌面歌词后显示注音');return;}
			if(!session){open();return;}if(invalidate)revision++;update(false,data);
			if(invalidate&&api.visibility)api.visibility(true).catch(e=>changed(e.message));
		}
		const unsubscribe=api.subscribe(sync),unwatch=api.watch?api.watch(invalidate=>sync(invalidate===true)):()=>{};
		const dispose=()=>{if(disposed)return;disposed=true;stop();unsubscribe();unwatch();win.removeEventListener('beforeunload',dispose);};win.addEventListener('beforeunload',dispose);
		return {sync,dispose,inspect:()=>({status,ready,opening:starting,track,hasClock:position!==null})};
	}
	return {nativeTimeline,lrcTimeline,lineAt,findBridge,nativeStyle,bounds,openSettings,browserTransport,host};
});
