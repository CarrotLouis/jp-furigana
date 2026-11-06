// Opt-in real Windows renderer/IPC test. No CloudMusic or real lyrics are used.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomBytes,webcrypto}=require('node:crypto'),{once}=require('node:events');
const {browserTransport}=require('../src/desktop.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function deadline(promise,ms,message){
	let timer;
	try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}
	finally{clearTimeout(timer);}
}
function track(child){
	const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});done.catch(()=>{});
	return {child,done};
}
const exists=p=>fs.access(p).then(()=>true,()=>false);
(async()=>{
	if(process.platform!=='win32'){console.log('SKIP: desktop-native needs Windows');return;}
	const dir=path.resolve(__dirname,'private/desktop-native');await fs.mkdir(dir,{recursive:true});
	const root=path.join(dir,'profile 空 '+randomBytes(6).toString('hex'));
	const runtime=path.join(root,'plugins_runtime','jp-furigana-plus'),desktopDir=path.join(root,'lyrics','jp-furigana','desktop');
	const bundled=path.join(runtime,'desktop-host.exe'),compiled=path.resolve(__dirname,'../src/desktop-host.exe');
	await fs.mkdir(runtime,{recursive:true});await fs.copyFile(compiled,bundled);
	const launches=[];
	let copies=0;
	const bn={
		fs:{exists,mkdir:async p=>{await fs.mkdir(p,{recursive:true});return true;},remove:async p=>{await fs.unlink(p);return true;},
			readFile:async p=>new Blob([await fs.readFile(p)]),readFileText:p=>fs.readFile(p,'utf8'),
			writeFile:async(p,data)=>{copies++;await fs.writeFile(p,Buffer.from(await data.arrayBuffer()));return true;}},
		app:{getDataPath:async()=>root,exec:async(command,elevated,visible)=>{
			assert(!elevated&&!visible);
			const match=/^"([^"]+)" ([A-Za-z0-9+/=]+)$/.exec(command);
			assert(match,'Execute the quoted renderer directly, without a shell');
			const exe=match[1],cfg=JSON.parse(Buffer.from(match[2],'base64').toString());
			assert.equal(path.dirname(exe),desktopDir);
			assert.notEqual(exe,bundled);
			const argument=Buffer.from(JSON.stringify({...cfg,offscreenTest:true})).toString('base64');
			launches.push({...track(spawn(exe,[argument],{windowsHide:true,stdio:'ignore'})),exe,ready:cfg.ready});
			return true;
		}}
	};
	const win={crypto:webcrypto,TextEncoder,btoa,AbortController,fetch,setTimeout,clearTimeout};
	const player=track(spawn(process.execPath,['-e',"const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>process.send(s.address().port));"],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']}));
	async function open(transport){
		const start=performance.now(),session=await transport.start(),launch=launches.at(-1);
		const info=JSON.parse(await fs.readFile(launch.ready,'utf8'));
		assert.equal(info.pid,launch.child.pid);assert.equal(info.protocol,2);
		const endpoint='http://127.0.0.1:'+info.port;
		const request=async(route,token=info.token)=>{
			const response=await fetch(endpoint+route+'?token='+token,{signal:AbortSignal.timeout(5000)});
			assert.equal(response.status,token===info.token?200:403);
			return response.json();
		};
		return {...launch,session,info,request,startupMs:Math.round(performance.now()-start)};
	}
	async function confirmExit(launch,ms,label){
		assert.equal(await deadline(launch.done,ms,label),0);
		assert.equal(await exists(launch.ready),false,'Ready file must be removed at exit');
	}
	try{
		const [port]=await deadline(once(player.child,'message'),5000,'Mock BetterNCM listener did not open');
		const transport=browserTransport(bn,{pluginPath:runtime},win,port);
		const first=await open(transport);
		assert(first.info.ownerBound,'Renderer should bind to the process hosting the BetterNCM listener');
		await first.request('/events','wrong');
		const frames=[{segments:[{text:'空',rt:'そら'},{text:'をみる'}],translation:'看天空',fontSize:35,topmost:false,style:{fontFamily:'微软雅黑',bold:false,colorTop:'#ffdede',colorBottom:'#ffb0b0',outline:true,outlineColor:'#cb7474'}},
			{segments:[{text:'町',rt:'まち'},{text:'へゆく'}],translation:'前往小镇',fontSize:48,rtWeight:'follow',locked:true,topmost:true,style:{vertical:true,bold:true,align:'split'},
				next:{segments:[{text:'風',rt:'かぜ'},{text:'の音'}],translation:'风声'},karaoke:true,highlightTo:1},
			{segments:[{text:'<script>文字だけ</script>',rt:'もじ'}],translation:'<img src=x>',fontSize:20,locked:false}];
		for(const frame of frames){assert((await first.session.send(frame)).ok);await sleep(100);}
		assert(Array.isArray((await first.session.events()).events));
		await fs.unlink(bundled);assert.equal(await exists(bundled),false,'BetterNCM can remove its bundled executable while the renderer runs');
		const health=await first.request('/health');assert.equal(health.version,first.info.version);assert(health.workingSetBytes>0);
		for(let i=0;i<3;i++)await first.session.events();const idle=await first.request('/health');
		await first.session.stop();await confirmExit(first,3000,'Explicit shutdown did not close the renderer');

		await fs.copyFile(compiled,bundled);
		const second=await open(transport);
		assert.equal(second.exe,first.exe);assert.equal(copies,1,'An identical and verified executable is reused');
		assert(second.info.ownerBound);
		assert((await second.session.send(frames[1])).ok);
		const polling=second.session.events().catch(()=>{});
		const deathStart=performance.now();player.child.kill();
		await confirmExit(second,3500,'Renderer did not exit promptly after the owner was killed');
		const ownerExitMs=Math.round(performance.now()-deathStart);await polling;

		const orphan=await open(browserTransport(bn,{pluginPath:runtime},win,0));
		assert.equal(orphan.info.ownerBound,false);
		await orphan.session.send(frames[0]);await sleep(5500);
		await orphan.request('/health'); // Diagnostics must not renew the lease.
		await confirmExit(orphan,6500,'Detached renderer outlived the frontend lease');
		const report={passed:true,startupMs:first.startupMs,workingSetMiB:Math.round(idle.workingSetBytes/1048576*10)/10,privateMiB:Math.round(idle.privateBytes/1048576*10)/10,idleCpuMilliseconds:Math.round(idle.cpuMilliseconds-health.cpuMilliseconds),frames:frames.length,
			cleanableRuntime:true,explicitStop:true,ownerExitMs,leaseExpiry:true};
		await fs.writeFile(path.join(dir,'ipc-result.json'),JSON.stringify(report,null,2));console.log('Native desktop IPC passed:',JSON.stringify(report));
	}finally{
		for(const item of [...launches,player])if(item.child.exitCode===null&&item.child.signalCode===null)item.child.kill();
		await Promise.allSettled([...launches,player].map(item=>item.done));
		for(const file of new Set([bundled,...launches.flatMap(item=>[item.exe,item.ready,item.ready+'.error'])]))try{await fs.unlink(file);}catch(_){}
	}
})().catch(error=>{console.error(error);process.exitCode=1;});
