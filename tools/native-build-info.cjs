// Public provenance for the exact native executable packaged by CI.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const hash=relative=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex');
const repository=process.env.GITHUB_REPOSITORY,run=process.env.GITHUB_RUN_ID;
const info={version:require('../src/manifest.json').version,sourceCommit:process.env.GITHUB_SHA||null,
	workflow:repository&&run?`https://github.com/${repository}/actions/runs/${run}`:null,
	nativeSourceSha256:hash('native/DesktopLyricsHost.cs'),nativeBuildScriptSha256:hash('tools/build-desktop-host.ps1'),
	nativeExecutableSha256:hash('src/desktop-host.exe'),pluginSha256:hash('builds/jp-furigana.plugin')};
fs.mkdirSync(path.join(root,'builds'),{recursive:true});
fs.writeFileSync(path.join(root,'builds/native-build-info.json'),JSON.stringify(info,null,2)+'\n');
console.log('Native build provenance written for '+info.version);
