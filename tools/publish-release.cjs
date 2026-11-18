'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function({github,context,core}){
 const dir=path.resolve(__dirname,'../builds'),info=JSON.parse(fs.readFileSync(path.join(dir,'release-info.json'),'utf8'));
 assert.equal(context.repo.owner,'CarrotLouis');assert.equal(context.repo.repo,'jp-furigana');
 const repo={owner:context.repo.owner,repo:context.repo.repo},tag='plus-v'+info.version;
 let release;try{release=(await github.rest.repos.getReleaseByTag({...repo,tag})).data;}catch(error){if(error.status!==404)throw error;}
 const body=[
  'Plus '+info.version+' 整合已通过测试的歌词管理、注音、搜索和桌面歌词改进。',
  '',
  '- 本地歌词管理：加载时可立即搜索和筛选已修改歌曲；查看歌词时可切换网站原始注音和应用纠音后的注音，仍可单独查看人工修改。修复播放并编辑及部分情况下关闭按钮不可见的问题。',
  '- 注音：识别歌词原文中的平假名、片假名和片假名词后的英文括号注音，保留和声歌词；人工纠音优先。英文注音上移，避免字母下沿压到歌词。',
  '- 网站搜索：扩大 UtaTen 同名候选的歌词核对，支持部分曲名和歌词片段兜底；多版本优先采用全曲歌词吻合的结果。失败时可打开官网搜索页，并复制曲名和首位歌手名。',
  '- 来源和设置：首次启用外部注音时默认仅使用 UtaTen；对选择自动或歌ネット的用户提示注音质量差异。同步网站授权提示、手动指定来源修复、注音字重和控制台诊断，继续支持独立代理。',
  '- 桌面歌词：支持竖排时在原文右侧显示注音，字重跟随设置；调整双行对齐和竖排尺寸，并修复退出网易云后窗口可能残留的问题。',
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
