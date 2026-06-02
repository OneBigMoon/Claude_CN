# claude-desktop-cn（macOS M5）

claude-desktop-cn 是 Claude Desktop macOS M5 专版汉化补丁工具，目标是补齐 Claude / Claude Code / Cowork / 第三方推理配置 / macOS 菜单里常见的英文残留。

当前作者：`OneBigMoon`

当前作者版本号：`v0.0.1`

当前维护者说明：本人是 M5 的笔记本，在 M4 上测试没有问题。M5 上遇到了一些奇奇怪怪的问题，于是参考大神的代码进行调整，并把遗漏的页面、菜单和硬编码文本继续补齐。

## 特别致谢

特别致谢并致敬 [Win-Hao/ClaudeCN](https://github.com/Win-Hao/ClaudeCN)。原项目提供了 Claude Desktop 汉化的早期思路和实践基础，本项目在此基础上整理为更完整的补丁流程，并继续补齐 Claude Code、Cowork、第三方推理配置、页面空状态和 macOS 菜单等遗漏。

## 使用方法

> 产品标识：**claude-desktop-cn（macOS M5）**。

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

### DMG 一键安装（推荐，最省心）

你只需要执行这三步：

1. 下载 `Releases` 中的 `claude-desktop-cn-macos-m5-0.0.1.dmg`（带版本号的这个才是这个项目的官方包）。
2. 解压后，双击 `claude-desktop-cn-installer.command`（仅此文件可一键安装）。
3. macOS 会弹出授权框，输入管理员密码即可自动完成汉化并重启 Claude。

如果你在安装后看不到变化：

- 请确认 Claude 的实际安装路径是 `/Applications/Claude.app`。
- 手动运行 `bash claude-desktop-cn-installer.command`，检查是否有错误提示。

### 生成 DMG（在 macOS 机器上）

```bash
npm run dist:dmg
```

脚本会生成：

- `dist/claude-desktop-cn-macos-m5-0.0.1.dmg`
- DMG 内含：`claude-desktop-cn-installer.command`（兼容保留：`Claude_CN_Installer.command`）、`README.md`、`scripts/`、`data/`、`node_modules/`

### 给作者/维护者的一键发布

有 `gh` CLI 的情况下，可直接执行：

```bash
npm run release:dmg
```

它会：

- 检查工作区是否干净。
- 以版本号创建/推送 `v0.0.1` 标签。
- 运行打包并将 `dist/claude-desktop-cn-macos-m5-0.0.1.dmg` 上传到 GitHub Releases。

## Releases 建议

建议用 `v` 打头的 tag（例如 `v0.0.1`）打包发布，这样 GitHub Releases 会按版本展示下载链接。

## 补丁内容

- 覆盖 `ion-dist/i18n/zh-CN.json` 的完整中文资源。
- 补齐前端 chunk 里的硬编码文本，例如项目页、计划任务页、侧栏、模式切换、网关配置等。
- 补齐 macOS 菜单中的 `Services`、`Hide Claude`、`Hide Others`、`Show All`、`Minimize`、`Bring All to Front` 和开发者菜单项。
- 写入 `zh-CN.lproj` / `zh_CN.lproj` 的 `InfoPlist.strings`。
- 重打包 `app.asar` 后自动更新 5 个 `Info.plist` 中的 `ElectronAsarIntegrity` hash。

## 注意

本项目不包含 Claude.app、Anthropic 官方二进制或任何商业资源，只提供本地补丁脚本和中文资源。Claude 更新后文件名和 chunk 内容可能变化，如果脚本提示某些硬编码项未命中，需要按新版本重新适配。
