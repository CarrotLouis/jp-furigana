# 日语歌词振假名 · jp-furigana

在网易云音乐的日文歌词的汉字上方标注振假名

此仓库是 [Leleawa/jp-furigana](https://github.com/Leleawa/jp-furigana) 的扩展版，保留上游的词典、音译和逐字歌词支持。新增 **UtaTen / 歌ネット外部读音来源、逐曲本地缓存、独立代理设置**，并修复旧字体与部分未知汉字漏注音的问题。

![截图](docs/screenshot.png)

## 环境

- 网易云音乐 **2.10.x / 3.x** (在 2.10.13 和 3.1.36 上实测)
- [BetterNCM](https://github.com/std-microblock/BetterNCM) **1.3.4+**

## 安装

从 [Releases](../../releases) 下载 `jp-furigana.plugin`, 放进 BetterNCM 的插件目录后重启网易云

本分支也可自行打包：安装 Node.js 后运行 `node tools/pack.js`，产物在 `builds/jp-furigana.plugin`。替换旧包前退出网易云，并把旧包备份到插件目录以外；不要同时保留两个同 slug 的包。默认目录为 `C:\betterncm\plugins`，自定义 BetterNCM 数据目录时以实际位置为准。

在「BetterNCM → 插件 → 日语歌词振假名」设置页，将「读音来源」切到 **外部网站** 即可使用新功能。可选 HTTP / HTTPS / SOCKS5 / SOCKS5H 代理，并可更改缓存文件夹。外部取词使用 Windows 自带 PowerShell 5.1 与 `curl.exe`，需要 Windows 10 1803 或更新版本；不安装运行库，不开启常驻服务。

完整的使用方式、获取策略与限制见 [外部歌词说明](docs/external-lyrics.md)，验证范围见 [测试记录](docs/validation.md)。

## 说明

- 默认在换歌时向网易云的歌词接口请求一次官方音译; 设置里把 "读音来源" 切成 "只用词典" 即完全离线, 由内置的 kuromoji + IPADIC 词典推读音
- 桌面歌词无效, 那是原生窗口而不是网页
- 外部网站模式：先显示网易云音译 / 词典结果；网站歌词读取成功后，只替换能匹配原文的读音。加载失败、同名版本不明确、原文对不上时继续回退。
- UtaTen 提供词级振假名，默认优先使用；歌ネット提供罗马音，作为备选。网站读音也可能有误，不能视作逐词人工审核结果。
- 本地歌词缓存默认位于 `<BetterNCM 数据目录>/lyrics/jp-furigana/`，每个网易云歌曲 ID 一个 JSON。缓存命中不重复联网，点击「重新获取当前歌曲」可更新。
- 查词时识别 `會/会`、`戀/恋`、`凜/凛`、`墮/堕` 等字形，显示时保留原字。补全 `堕とす / 堕ちる` 的语境读音；未知汉字仅在罗马音对齐无歧义时补注。

## 开发

```sh
npm ci
npm test
node tools/test-rnp-dom.js slide noruby
node tools/test-rnp-dom.js lyricbar
npm run build
```

可选真实网站测试（Windows，会联网）：`node tools/test-external-live.cjs`。真实歌词与网络样本只写入 Git 忽略的 `tests/private/`。新增功能无 npm 运行时依赖；jsdom 仅用于开发测试。

`outputs/`、运行缓存、真实歌词及代理本地配置均不提交。完成一轮修改并验证后，提交并推送到此 fork。

## 许可

插件自身的代码采用 **MIT** 协议, 见 [LICENSE](LICENSE)

打包分发的第三方组件见 [NOTICE.md](NOTICE.md):

| 组件 | 许可 |
| --- | --- |
| `kuromoji.js` | Apache-2.0 ([LICENSE-kuromoji.txt](LICENSE-kuromoji.txt)), 已修改, 文件头带修改说明 |
| `dict/*.dat.gz` | mecab-ipadic-2.7.0-20070801, NAIST + ICOT |
