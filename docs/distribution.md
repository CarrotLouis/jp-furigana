# 独立维护与商店分发

## 项目标识

- 名称：日语歌词振假名 Plus。
- 插件 slug：`jp-furigana-plus`，来源标记：`fork_of: "jp-furigana"`。
- 维护者：CarrotLouis；上游作者：leleawa。
- 商店跟踪：`CarrotLouis/jp-furigana` 的 `standalone` 分支，子目录 `/src`。
- `main` 保留向上游贡献的版本与原 PR；独立版的后续修复、版本发布和商店更新使用 `standalone`。

源码、使用说明和问题反馈分别为：

- [独立版源码与说明](https://github.com/CarrotLouis/jp-furigana/tree/standalone)
- [问题反馈](https://github.com/CarrotLouis/jp-furigana/issues)
- [上游项目](https://github.com/Leleawa/jp-furigana)

## 安装与迁移

Plus 与原版功能重叠，应只启用一个版本。先在 BetterNCM 中移除原版并退出网易云；也可退出网易云后将旧 `.plugin` 移到插件目录外，再安装 Plus。若同时检测到 `jp-furigana`，Plus 会在设置中说明冲突并暂停启动，移除原版后重启即可。

独立版使用自己的模块、词典读取钩子、设置及计算缓存。首次启动时，若尚无 Plus 设置，会复制旧 `jp-furigana.config` 一次；后续保存不会覆盖旧设置。保留默认网站缓存目录 `<BetterNCM 数据目录>/lyrics/jp-furigana/`，以兼容先前扩展版已保存的网站歌词和人工纠音 JSON。自定义缓存目录也可继续使用。

每个歌曲 ID 仍只有一份歌曲 JSON；不要将实际歌词、用户修改或代理地址放进源码或发布包。

## 分发内容与复现

商店应登记 `/src`；该目录只含运行脚本、PowerShell 源文件、预览图、离线词典及所需许可证。`node tools/pack.js` 的本地包与 `/src` 文件清单一致，不依赖构建时下载歌词或私有服务。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:store
npm test
node tools/test-rnp-dom.js slide noruby
node tools/test-rnp-dom.js lyricbar
node tools/pack.js
```

本地包：`builds/jp-furigana-plus.plugin`。GitHub Actions 对 `standalone` 执行离线回归、商店检查和打包，并提供 `jp-furigana-plus-plugin` artifact。Windows 作业另验证实际文件原子保存。没有自带的原生可执行程序或 DLL，无需下载或安装额外运行库。

## 网络、进程与本地数据

- 默认来源是网易云音译；外部网站来源需用户选择。词典来源不向歌词网站联网。
- 网易云模式使用客户端的歌曲信息和官方歌词接口；外部模式会向 UtaTen 或歌ネット发送当前歌名、歌手及歌词页地址，歌词片段核对在本地完成。
- 仅访问代码限定的两个网站 HTTPS 地址；保持 TLS 证书验证，不绕过登录或验证码。代理仅用于网站请求，不包含账号密码。
- Windows 自带 PowerShell 与 `curl.exe` 按需执行；PowerShell 脚本随源码公开。获取失败保留原有注音，取消和重试次数有上限，没有常驻服务或全曲库爬取任务。
- 歌词、来源地址及人工修改保存到本地 JSON；代理配置保存在客户端本地设置中。插件不提供缓存上传、公共歌词数据库或遥测功能。
- 文件保存使用临时文件校验与原子替换；临时交换文件在完成后清理。

## 许可与外部内容

插件代码保留上游 MIT 许可与版权声明；kuromoji 的 Apache 2.0 许可、修改说明及 IPADIC 的 NAIST／ICOT 声明均随源码和包保留。详见 [LICENSE](../LICENSE)、[NOTICE](../NOTICE.md) 和 [Apache 许可全文](../LICENSE-kuromoji.txt)。

代码开源许可不授予歌词内容的使用权。当前没有取得 UtaTen 或歌ネット针对本插件的个别书面数据授权：

- [歌ネット使用条款](https://www.uta-net.com/info/kiyaku.html)限制未经许可的复制、分发及抓取。
- [UtaTen 使用条款](https://utaten.com/index/agreement)第 8 条将个人非营利浏览以外的复制、转载、修改等使用列为需要事先书面许可。

外部来源的自动获取和本地缓存存在需要另行确认的条款问题；关闭自动重试、保留来源链接或不随包分发歌词，均不等于获得授权。商店提交应完整披露此行为与授权状态，由维护者判断是否收录或要求调整。发布包不包含实际下载的歌词缓存。

## 兼容性与验收边界

最低声明 BetterNCM 1.3.4；沿用上游网易云 2.10.x／3.x 网页歌词适配，RNP 设置适配 3.0.2，原生桌面歌词不支持。新旧内核与逐字 filler 的模拟 DOM、实际词典和 Windows 原子保存分别测试，不将模拟结果写作全版本实机验证。完整记录见 [验证记录](validation.md)。

## 后续商店更新

后续在 `standalone` 修改、验证，并提升 `src/manifest.json` 与 npm 元数据版本后推送。商店按登记的分支和 `/src` 生成更新审核；本仓库推送成功不等于商店审核已通过。保持同一独立 slug，不使用强制安装／更新／卸载字段，不改动原作者的商店来源。

参考：[插件库提交说明](https://github.com/BetterNCM/BetterNCM-Plugins#插件提交及更新)、[官方上架准则](https://github.com/std-microblock/chromatic/wiki/插件商店上架插件方式及准则)。
