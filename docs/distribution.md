# 构建与商店分发

## 项目标识与配置

- 名称：日语歌词振假名；插件标识：`jp-furigana`；作者：leleawa。
- [源码与说明](https://github.com/Leleawa/jp-furigana)、[问题反馈](https://github.com/Leleawa/jp-furigana/issues)和 manifest 作者链接均指向原仓库。
- RefinedNowPlayingNext 为可选适配，已适配 3.0.2；未安装时使用 BetterNCM 插件设置与受支持的原歌词页面。
- 原版设置继续存入 `jp-furigana.config`。仅在没有原版设置时复制 Plus 偏好一次；已有原版配置优先，Plus 原配置不修改。
- 歌曲文件继续使用 `<BetterNCM 数据目录>/lyrics/jp-furigana/<歌曲 ID>.json`；网站字段、`manualSource` 与 `userEdits` 保持原结构，每曲一个文件。

从 Plus 迁移时先退出网易云，把 Plus 包移到插件目录外，再安装本版。人工纠音与网站 JSON 无需转换；自定义路径也可继续使用。不要将实际歌词、用户修改、代理地址或账号凭据放入源码和发布包。

## 本地构建

商店登记子目录 `/src`，其中包含运行脚本、公开 PowerShell 源码、预览图、离线词典、许可副本及桌面组件 `desktop-host.exe`。`node tools/pack.js` 的文件清单与 `/src` 一致，manifest 位于 ZIP 根层。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:store
npm test
node tools/test-rnp-dom.js slide noruby
node tools/test-rnp-dom.js lyricbar
node tools/pack.js
```

本地产物是 `builds/jp-furigana.plugin`。商店会将预览图单独发布，所以商店包与本地包的预览图封装方式不同，运行源码一致。

桌面组件公开源码为 `native/DesktopLyricsHost.cs`，MIT 许可；Windows 使用系统 .NET Framework 4.8/WPF 编译，无本机 DLL 注入：

```powershell
powershell.exe -NoProfile -File tools/build-desktop-host.ps1 -Check
node tests/cache-write.test.cjs
node tests/desktop-native.test.cjs
```

## CI 与上游发布

[CI](https://github.com/Leleawa/jp-furigana/actions/workflows/ci.yml) 保留原有 `main` 自动发布行为，增加 Windows 原生组件编译作业：

1. `test` 在 Linux 执行语法、分发、离线回归、六种 RNP / LyricBar 兼容场景与打包检查。
2. `windows-native` 删除工作目录原有可执行文件，从公开 C# 源码重新编译，执行透明绘制自测、文件原子保存及实际回环 IPC / 生命周期测试。
3. Windows 作业用本次编译文件打包，上传 `jp-furigana-plugin` artifact，包含 `.plugin`、可执行文件和 `native-build-info.json`。来源记录包含输入提交、工作流地址及源码、构建脚本、可执行文件、插件包的 SHA-256。
4. 只有上述两项作业都成功，且事件为 **Leleawa/jp-furigana 的 main 推送**时，发布作业才以 `contents: write` 创建 `v<manifest.version>` Release，附上 Windows 作业的包和来源记录。标签已存在则跳过。
5. Fork 与 PR 运行相同检查和 Windows 编译，但不自动创建独立 Release，不快进其他分支，也不替上游发布。

仓库 `/src` 保留可分发的桌面组件。修改 C# 源码后应使用相同提交的 GitHub Actions 产物更新该文件，并保留构建来源记录；不要用未经验证的本地二进制覆盖商店运行文件。CI Release 使用当前 Windows 作业重新编译的包。

## 网络、进程与本地数据

- 默认读音来源是网易云音译；外部网站需用户选择。在音译／词典模式主动进入编辑时，如果缺少网站数据，也会先尝试网站获取；可两次点击明确中断后编辑。
- 仅当前歌曲原歌词确认包含日语时触发注音与外部网站获取；曲名、歌手、翻译、制作信息和旧曲残留不作为判断依据。
- 外部请求向 UtaTen 或歌ネット发送歌名、歌手或歌词页 URL；歌词片段核对在本地完成。地址限定 HTTPS，验证 TLS，不绕过登录或验证码。
- PowerShell 与系统 `curl.exe` 按需运行；失败回退并显示原因，重试有界，无全曲库爬取任务。代理配置仅存本地，不随包发布。
- 歌曲 JSON 仅存本地，无遥测、缓存上传或公共歌词数据库。临时文件校验后原子替换，写入失败保留原文件。
- 可选桌面组件仅在启用桌面注音且原桌面歌词开启时运行，用本机回环与随机密钥传递当前行，停用后退出，详见 [桌面注音](desktop-lyrics.md)。

## 许可与外部内容

插件代码保留上游 MIT 许可与版权声明；kuromoji 的 Apache 2.0 许可、修改说明及 IPADIC 的 NAIST／ICOT 声明均随源码和包保留。详见 [LICENSE](../LICENSE)、[NOTICE](../NOTICE.md) 和 [Apache 许可全文](../LICENSE-kuromoji.txt)。

代码开源许可不授予歌词内容的使用权。当前没有取得 UtaTen 或歌ネット针对本插件的个别书面数据授权：

- [歌ネット使用条款](https://www.uta-net.com/info/kiyaku.html)限制未经许可的复制、分发及抓取。
- [UtaTen 使用条款](https://utaten.com/index/agreement)第 8 条将个人非营利浏览以外的复制、转载、修改等使用列为需要事先书面许可。

外部来源的自动获取和本地缓存存在需要另行确认的条款问题；关闭自动重试、保留来源链接或不随包分发歌词，均不等于获得授权。商店提交应完整披露此行为与授权状态，由维护者判断是否收录或要求调整。发布包不包含实际下载的歌词缓存。

## 商店更新路径

继续使用原插件 `jp-furigana` 的原仓库登记和 `/src`；无需新建独立插件条目。商店的源码更新脚本读取登记仓库及分支，生成 `plugins-data` 更新审核 PR。审核合并后，打包工作流把预览图发布到 `previews/`，将运行文件打成 `.plugin` 并更新索引；不需要把手工生成的插件包提交到插件库。

独立 Plus 版的下架需等原版合并并上架后另行处理，本次不修改其商店条目。仓库推送成功不等于商店已完成更新。

流程参考：[插件库提交说明](https://github.com/BetterNCM/BetterNCM-Plugins#插件提交及更新)、[官方上架准则](https://github.com/std-microblock/chromatic/wiki/插件商店上架插件方式及准则)、[源码更新脚本](https://github.com/BetterNCM/BetterNCM-Plugins/blob/master/scripts/update-plugins/update-plugins.js)和[打包工作流](https://github.com/BetterNCM/BetterNCM-Plugins/blob/master/.github/workflows/pack-and-push.yml)。

基础网页逻辑保留原有 2.10.x / 3.x 适配，不把 DOM 模拟测试表述成所有版本实机验证。透明桌面注音在网易云 3.1.42 验证；目前仅支持横排，竖排回退原窗口。完整边界见 [验证记录](validation.md)。
