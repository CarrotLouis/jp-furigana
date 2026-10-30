'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function({github,context,core}){
 const dir=path.resolve(__dirname,'../builds'),info=JSON.parse(fs.readFileSync(path.join(dir,'release-info.json'),'utf8'));
 assert.equal(context.repo.owner,'CarrotLouis');assert.equal(context.repo.repo,'jp-furigana');
 const repo={owner:context.repo.owner,repo:context.repo.repo},tag='plus-v'+info.version;
 let release;try{release=(await github.rest.repos.getReleaseByTag({...repo,tag})).data;}catch(error){if(error.status!==404)throw error;}
 const body='新增透明桌面振假名，沿用原桌面歌词样式、原生设置菜单、锁定穿透和播放控制；固定注音/原文/翻译位置，范围提示延迟 2 秒隐藏。\n\n桌面注音默认随原桌面歌词启停，关闭后隐藏其样式选项；保留已经保存的关闭选择。\n\n外部搜索会清理 feat./cover/remix 等附注，依歌手顺序查询后再用歌词核对同名结果。新增手动指定 UtaTen 歌词页，保存在本曲 JSON，可清空恢复自动搜索；保留人工纠音。包含 UtaTen HTTP 200 空页面修复。\n\n安装更新后重启网易云。完整功能说明和本地文件/网络行为见 [README](https://github.com/CarrotLouis/jp-furigana/tree/standalone) 和 [分发说明](https://github.com/CarrotLouis/jp-furigana/blob/standalone/docs/distribution.md)。\n\n- [编译与测试记录]('+info.workflow+')\n- [正式源码](https://github.com/CarrotLouis/jp-furigana/tree/'+info.publicationCommit+')\n- [构建输入](https://github.com/CarrotLouis/jp-furigana/tree/'+info.sourceCommit+')\n- 原生组件由 GitHub Actions 从公开 C# 源码编译；包内文件与商店跟踪分支逐一校验。\n';
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
