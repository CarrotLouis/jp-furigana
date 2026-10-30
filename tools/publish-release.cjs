'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function({github,context,core}){
 const dir=path.resolve(__dirname,'../builds'),info=JSON.parse(fs.readFileSync(path.join(dir,'release-info.json'),'utf8'));
 assert.equal(context.repo.owner,'CarrotLouis');assert.equal(context.repo.repo,'jp-furigana');
 const repo={owner:context.repo.owner,repo:context.repo.repo},tag='plus-v'+info.version;
 let release;try{release=(await github.rest.repos.getReleaseByTag({...repo,tag})).data;}catch(error){if(error.status!==404)throw error;}
 const body='修复‘启用注音桌面歌词’误打开网易云桌面歌词的问题。注音开关与网易云桌面歌词开关相互独立，只有两者均开启时桌面注音才生效。只开注音时不启动绘制组件、不打开原窗口；之后打开桌面歌词即自动显示注音。关闭桌面歌词保留注音偏好，关闭注音则恢复仍处于开启状态的原桌面歌词。\n\n包含 1.6.0 的全部功能。已补充两种开启顺序、关闭/重开、启动取消，以及两处设置页不更改原开关的回归。安装更新后重启网易云。完整功能说明和本地文件/网络行为见 [README](https://github.com/CarrotLouis/jp-furigana/tree/standalone) 和 [分发说明](https://github.com/CarrotLouis/jp-furigana/blob/standalone/docs/distribution.md)。\n\n- [编译与测试记录]('+info.workflow+')\n- [正式源码](https://github.com/CarrotLouis/jp-furigana/tree/'+info.publicationCommit+')\n- [构建输入](https://github.com/CarrotLouis/jp-furigana/tree/'+info.sourceCommit+')\n- 原生组件由 GitHub Actions 从公开 C# 源码编译；包内文件与商店跟踪分支逐一校验。\n';
 let ref;try{ref=(await github.rest.git.getRef({...repo,ref:'tags/'+tag})).data;}catch(error){if(error.status!==404)throw error;ref=(await github.rest.git.createRef({...repo,ref:'refs/tags/'+tag,sha:info.publicationCommit})).data;}
 assert.equal(ref.object.sha,info.publicationCommit,'Release tag must identify the published tree');
 if(!release)release=(await github.rest.repos.createRelease({...repo,tag_name:tag,target_commitish:info.publicationCommit,name:'日语歌词振假名 Plus '+info.version,body,draft:true,prerelease:false})).data;
 const assets=(await github.rest.repos.listReleaseAssets({...repo,release_id:release.id})).data;
 for(const name of [info.packageName,'SHA256SUMS.txt']){
  const data=fs.readFileSync(path.join(dir,name)),digest='sha256:'+require('node:crypto').createHash('sha256').update(data).digest('hex'),existing=assets.find(a=>a.name===name);
  if(existing){if(existing.digest===digest)continue;if(!release.draft)throw Error('Refusing to overwrite an existing published asset: '+name);await github.rest.repos.deleteReleaseAsset({...repo,asset_id:existing.id});}
  await github.rest.repos.uploadReleaseAsset({...repo,release_id:release.id,name,data,headers:{'content-type':'application/octet-stream','content-length':data.length}});
 }
 if(release.draft)await github.rest.repos.updateRelease({...repo,release_id:release.id,draft:false,prerelease:false});
 core.info('Published '+release.html_url);
};
