// Reads Git objects so the downloadable package and store use identical bytes.
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {collect,buildZip}=require('./pack.js'),root=path.resolve(__dirname,'..');
const git=(...args)=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,maxBuffer:32*1024*1024});
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function main(){
 const commit=process.argv[2];assert(/^[a-f0-9]{40}$/.test(commit),'Pass the published commit SHA');
 const info=JSON.parse(git('show',commit+':desktop-build-info.json').toString('utf8'));
 const entries=collect().map(e=>{const data=git('show',commit+':src/'+e.name);assert.equal(hash(data),info.files[e.name],'Published bytes differ: '+e.name);return{name:e.name,data,mtime:new Date(info.sourceDateEpoch*1000)};});
 assert.equal(entries.find(e=>e.name==='desktop-host.exe').data.subarray(0,2).toString(),'MZ');
 const data=buildZip(entries),dir=path.join(root,'builds'),name='jp-furigana-plus-'+info.version+'.plugin';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),data);
 const packageSha256=hash(data);fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),packageSha256+'  '+name+'\n');
 fs.writeFileSync(path.join(dir,'release-info.json'),JSON.stringify({...info,publicationCommit:commit,packageName:name,packageSha256,packageBytes:data.length},null,2)+'\n');
 console.log('Prepared '+name+' '+packageSha256);
}
if(require.main===module)main();
