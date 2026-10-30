// Publishes only a verified GitHub Actions build. No local release shortcut.
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {collect}=require('./pack.js'),root=path.resolve(__dirname,'..');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const git=(...args)=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,maxBuffer:32*1024*1024});
const text=(...args)=>git(...args).toString('utf8').trim();
function main(){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'src/manifest.json'),'utf8')),version=manifest.version;
 assert.equal(process.env.GITHUB_ACTIONS,'true','Publication is restricted to GitHub Actions');
 assert.equal(process.env.GITHUB_REPOSITORY,'CarrotLouis/jp-furigana');
 assert.equal(process.env.GITHUB_REF,'refs/heads/release/'+version,'Branch name must match the release version');
 const source=text('rev-parse','HEAD');assert.equal(source,process.env.GITHUB_SHA);
 const latest=text('ls-remote','--heads','origin',process.env.GITHUB_REF).split(/\s/)[0];assert.equal(latest,source,'A newer candidate supersedes this build');
 git('fetch','--no-tags','origin','standalone');const parent=text('rev-parse','FETCH_HEAD');
 const entries=collect(),files=Object.fromEntries(entries.map(e=>[e.name,sha(e.data)]));
 const nativeSourceSha256=sha(fs.readFileSync(path.join(root,'native/DesktopLyricsHost.cs'))),nativeBuildScriptSha256=sha(fs.readFileSync(path.join(root,'tools/build-desktop-host.ps1')));
 let previous;if(text('ls-tree','--name-only',parent,'desktop-build-info.json'))previous=JSON.parse(text('show',parent+':desktop-build-info.json'));
 let publication;
 if(previous&&previous.version===version){
  assert.equal(previous.nativeSourceSha256,nativeSourceSha256,'Native code changed without a version bump');
  assert.equal(previous.nativeBuildScriptSha256,nativeBuildScriptSha256,'Native build changed without a version bump');
  for(const[name,hash]of Object.entries(files))if(name!=='desktop-host.exe')assert.equal(previous.files[name],hash,'Runtime changed without a version bump: '+name);
  assert.deepEqual(Object.keys(previous.files).sort(),Object.keys(files).sort());
  publication=parent; // Reuse its exact bytes when retrying a failed publication.
 }else{
  if(previous)assert(compare(previous.version,version)<0,'Cannot publish an older version');
  git('merge-base','--is-ancestor',parent,source);
  const info={version,sourceCommit:source,sourceDateEpoch:Number(text('show','-s','--format=%ct',source)),workflow:'https://github.com/CarrotLouis/jp-furigana/actions/runs/'+process.env.GITHUB_RUN_ID,nativeSourceSha256,nativeBuildScriptSha256,files};
  fs.writeFileSync(path.join(root,'desktop-build-info.json'),JSON.stringify(info,null,2)+'\n');
  git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
  git('add','--','src/desktop-host.exe','desktop-build-info.json');
  git('commit','-m','Publish verified '+version+' native renderer from GitHub Actions');
  publication=text('rev-parse','HEAD');git('push','origin','HEAD:refs/heads/standalone');
 }
 fs.appendFileSync(process.env.GITHUB_OUTPUT,'commit='+publication+'\n');console.log('Published standalone '+publication);
}
function compare(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}
if(require.main===module)main();
module.exports={compare};
