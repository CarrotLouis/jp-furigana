'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function({github,context,core}){
 const dir=path.resolve(__dirname,'../builds'),info=JSON.parse(fs.readFileSync(path.join(dir,'release-info.json'),'utf8'));
 assert.equal(context.repo.owner,'CarrotLouis');assert.equal(context.repo.repo,'jp-furigana');
 const repo={owner:context.repo.owner,repo:context.repo.repo},tag='plus-v'+info.version;
 let release;try{release=(await github.rest.repos.getReleaseByTag({...repo,tag})).data;}catch(error){if(error.status!==404)throw error;}
 const body=[
  'Plus 1.6.3 保留透明桌面注音，继续独立维护；网页功能和原作者的合并工作单独推进。本版整合最后一轮 r4 测试通过的功能与修复。',
  '',
  '- 通用异文对齐：结合整句与前后歌词确认对应关系，保留网易云原文，即使汉字、假名或字数不同也映射网站读音；边界无法唯一拆分时合并注音单元，人工纠音仍优先。',
  '- 请求中编辑采用两次点击确认；仅有人工修改的 JSON 不会阻止后续网站获取，重新获取保留修改。',
  '- 修复播放并编辑改变全局网站范围、删除当前缓存后不再获取、部分已知读音丢失及促音规则过严。',
  '- 纠音浮窗完整避让当前行；滑块松开后保存，减少重复间距测量。合并后的长注音也可编辑。',
  '- 保留透明桌面歌词、原样式与菜单、锁定穿透、固定注音位置，以及只对当前日语原歌词触发功能的规则。',
  '',
  '安装更新后重启网易云。请只启用 Plus 或原版中的一个；缓存和人工纠音 JSON 可继续使用，无需重新获取。完整说明与本地文件/网络行为见 [README](https://github.com/CarrotLouis/jp-furigana/tree/standalone) 和 [分发说明](https://github.com/CarrotLouis/jp-furigana/blob/standalone/docs/distribution.md)。',
  '',
  '- [编译与测试记录]('+info.workflow+')',
  '- [正式源码](https://github.com/CarrotLouis/jp-furigana/tree/'+info.publicationCommit+')',
  '- [构建输入](https://github.com/CarrotLouis/jp-furigana/tree/'+info.sourceCommit+')',
  '- 原生组件由 GitHub Actions 从公开 C# 源码编译；下载包与商店跟踪分支逐文件校验。',
  ''
 ].join('\n');
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
