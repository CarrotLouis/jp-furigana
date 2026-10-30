'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function({github,context,core}){
 const dir=path.resolve(__dirname,'../builds'),info=JSON.parse(fs.readFileSync(path.join(dir,'release-info.json'),'utf8'));
 assert.equal(context.repo.owner,'CarrotLouis');assert.equal(context.repo.repo,'jp-furigana');
 const repo={owner:context.repo.owner,repo:context.repo.repo},tag='plus-v'+info.version;
 let release;try{release=(await github.rest.repos.getReleaseByTag({...repo,tag})).data;}catch(error){if(error.status!==404)throw error;}
 const body='修复纯英文等非日语歌曲误触发外部搜索的问题。网页注音、外部获取、手动指定、编辑和桌面替代共用当前原歌词的日语判断；制作信息、翻译、歌名、歌手及旧曲残留不作依据。英日混合和 YRC-only 日语歌继续支持。\n\n语种等待/失败时不访问外站，并在设置中显示原因；未知状态的重新获取先复查网易云原文。非日语曲恢复原桌面歌词，保留注音偏好。复用原有网易云歌词请求，不逐曲增加百科查询或语言数据库。实测《Sunshine Girl》和《Drown》保留支持，纯英文《Attention》跳过。\n\n包含 1.6.1 的桌面开关独立修复。安装更新后重启网易云。完整说明与本地文件/网络行为见 [README](https://github.com/CarrotLouis/jp-furigana/tree/standalone) 和 [分发说明](https://github.com/CarrotLouis/jp-furigana/blob/standalone/docs/distribution.md)。\n\n- [编译与测试记录]('+info.workflow+')\n- [正式源码](https://github.com/CarrotLouis/jp-furigana/tree/'+info.publicationCommit+')\n- [构建输入](https://github.com/CarrotLouis/jp-furigana/tree/'+info.sourceCommit+')\n- 原生组件由 GitHub Actions 从公开 C# 源码编译；包内文件与商店跟踪分支逐一校验。\n';
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
