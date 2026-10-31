// Opt-in real Windows renderer/IPC test. No CloudMusic or real lyrics are used.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
	if(process.platform!=='win32'){console.log('SKIP: desktop-native needs Windows');return;}
	const dir=path.resolve(__dirname,'private/desktop-native');await fs.mkdir(dir,{recursive:true});
	const token=randomBytes(16).toString('hex'),ready=path.join(dir,'desktop-'+token+'.json'),start=performance.now();
	const config=Buffer.from(JSON.stringify({token,ready,offscreenTest:true})).toString('base64');
	const child=spawn(path.resolve(__dirname,'../src/desktop-host.exe'),[config],{windowsHide:true,stdio:'ignore'});
	let endpoint,exited=false;const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{exited=true;resolve(code);});});
	try{
		let info;for(let i=0;i<100;i++){try{info=JSON.parse(await fs.readFile(ready,'utf8'));break;}catch(_){}if(exited)throw Error('Native host exited before ready');await sleep(100);}
		assert(info,'Native ready timeout');assert.equal(info.token,token);assert.equal(info.protocol,1);const startupMs=Math.round(performance.now()-start);endpoint='http://127.0.0.1:'+info.port;
		const request=async(route,body)=>{const response=await fetch(endpoint+route+'?token='+token,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json();};
		assert.equal((await fetch(endpoint+'/events?token=wrong')).status,403,'Requests without the per-session key must be rejected');
		const frames=[{segments:[{text:'空',rt:'そら'},{text:'をみる'}],translation:'看天空',fontSize:35,topmost:false,style:{fontFamily:'微软雅黑',bold:false,colorTop:'#ffdede',colorBottom:'#ffb0b0',outline:true,outlineColor:'#cb7474'}},
			{segments:[{text:'町',rt:'まち'},{text:'へゆく'}],translation:'前往小镇',fontSize:48,locked:true,topmost:true},
			{segments:[{text:'<script>文字だけ</script>',rt:'もじ'}],translation:'<img src=x>',fontSize:20,locked:false}];
		for(const frame of frames){assert((await request('/frame',frame)).ok);await sleep(100);}
		const events=await request('/events');assert(Array.isArray(events.events));
		const health=await request('/health');assert.equal(health.version,info.version,'Ready and health must describe the same native component');assert(health.workingSetBytes>0);
		for(let i=0;i<3;i++)await request('/events');const idle=await request('/health');
		await request('/stop',{});const code=await Promise.race([exit,sleep(5000).then(()=>{throw Error('Native host did not exit');})]);assert.equal(code,0);
		assert.equal(await fs.access(ready).then(()=>true,()=>false),false,'Ready file must be removed at exit');
		const report={passed:true,startupMs,workingSetMiB:Math.round(idle.workingSetBytes/1048576*10)/10,privateMiB:Math.round(idle.privateBytes/1048576*10)/10,idleCpuMilliseconds:Math.round(idle.cpuMilliseconds-health.cpuMilliseconds),frames:frames.length,exited:true};
		await fs.writeFile(path.join(dir,'ipc-result.json'),JSON.stringify(report,null,2));console.log('Native desktop IPC passed:',JSON.stringify(report));
	}finally{if(!exited)child.kill();for(const file of [ready,ready+'.error'])try{await fs.unlink(file);}catch(_){} }
})().catch(error=>{console.error(error);process.exitCode=1;});
