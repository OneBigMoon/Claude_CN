# Claude_CN

Claude Desktop 中文汉化补丁工具，目标是补齐 Claude / Claude Code / Cowork / 第三方推理配置 / macOS 菜单里常见的英文残留。

当前作者：`OneBigMoon`

当前作者版本号：`v0.1.0`

当前维护者说明：本人是 M5 的笔记本，在 M4 上测试没有问题。M5 上遇到了一些奇奇怪怪的问题，于是参考大神的代码进行调整，并把遗漏的页面、菜单和硬编码文本继续补齐。

## 特别致谢

特别致谢并致敬 [Win-Hao/ClaudeCN](https://github.com/Win-Hao/ClaudeCN)。原项目提供了 Claude Desktop 汉化的早期思路和实践基础，本项目在此基础上整理为更完整的补丁流程，并继续补齐 Claude Code、Cowork、第三方推理配置、页面空状态和 macOS 菜单等遗漏。

## 使用方法

先安装依赖：

```bash
npm install
```

给默认路径 `/Applications/Claude.app` 打补丁并自动重启：

```bash
npm run patch
```

只打补丁、不重启：

```bash
npm run patch:no-restart
```

指定 Claude.app 路径：

```bash
node scripts/patch-claude-cn.mjs --app /Applications/Claude.app --restart
```

## 补丁内容

- 覆盖 `ion-dist/i18n/zh-CN.json` 的完整中文资源。
- 补齐前端 chunk 里的硬编码文本，例如项目页、计划任务页、侧栏、模式切换、网关配置等。
- 补齐 macOS 菜单中的 `Services`、`Hide Claude`、`Hide Others`、`Show All`、`Minimize`、`Bring All to Front` 和开发者菜单项。
- 写入 `zh-CN.lproj` / `zh_CN.lproj` 的 `InfoPlist.strings`。
- 重打包 `app.asar` 后自动更新 5 个 `Info.plist` 中的 `ElectronAsarIntegrity` hash。

## 注意

本项目不包含 Claude.app、Anthropic 官方二进制或任何商业资源，只提供本地补丁脚本和中文资源。Claude 更新后文件名和 chunk 内容可能变化，如果脚本提示某些硬编码项未命中，需要按新版本重新适配。
