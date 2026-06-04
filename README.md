# claude-desktop-cn（macOS M5）

**claude-desktop-cn（macOS M5）是 Claude Desktop 全部汉化版本。**
面向 Claude Desktop / Claude Code / Cowork / 第三方推理配置 / macOS 菜单做了全量中文化补齐，目标是尽量把界面常见英文残留清理到位。

当前作者：`OneBigMoon`

当前作者版本号：`v0.0.4`

当前维护者说明：本人是 M5 的笔记本，在 M4 上测试没有问题。M5 上遇到了一些奇奇怪怪的问题，于是参考大神的代码进行调整，并把遗漏的页面、菜单和硬编码文本继续补齐。

## 特别致谢

特别致谢并致敬 [Win-Hao/ClaudeCN](https://github.com/Win-Hao/ClaudeCN)。原项目提供了 Claude Desktop 汉化的早期思路和实践基础，本项目在此基础上整理为更完整的补丁流程，并继续补齐 Claude Code、Cowork、第三方推理配置、页面空状态和 macOS 菜单等遗漏。

## 使用方法

### 普通用户下载哪个文件？

当前正式版本：[`v0.0.4`](https://github.com/OneBigMoon/Claude_CN/releases/tag/v0.0.4)

推荐下载：

- `ClaudeCN-macos.zip`：解压后得到 `ClaudeCN.app`，这是推荐给普通用户的菜单栏应用。
- `claude-desktop-cn-macos-m5-0.0.4.dmg`：App 型 DMG，打开后可直接运行或拖拽安装 `ClaudeCN.app`。
- 源码包：适合维护者、开发者和想自己适配新 Claude 版本的人。

### ClaudeCN.app 使用方式（推荐）

1. 从 `Releases` 下载 `ClaudeCN-macos.zip`。
2. 解压后得到 `ClaudeCN.app`，可以拖到 `/Applications`。
3. 打开 `ClaudeCN.app`，菜单栏会出现 `ClaudeCN`。
4. 点击菜单栏里的 `一键汉化并重启 Claude`。
5. 如果 Claude 不在默认路径 `/Applications/Claude.app`，请选择 `选择 Claude.app 后汉化…`。

菜单栏应用包含这些功能：

- 一键汉化并重启 Claude。
- 选择自定义 `Claude.app` 路径后汉化。
- 检查当前汉化/语言状态。
- 打开 Claude。
- 打开运行日志。
- 打开项目主页。

首次打开时，如果 macOS 提示“无法验证开发者”：

- 右键点击 `ClaudeCN.app`，选择 `打开`。
- 或进入 `系统设置 > 隐私与安全性`，允许打开该应用。

执行汉化时，macOS 可能会要求输入管理员密码。这是因为工具需要修改 `/Applications/Claude.app`、重打包 `app.asar`、重签名并重启 Claude。工具不会上传你的 Claude 数据、账号信息或聊天内容。

Claude Desktop 更新后，官方更新可能会覆盖已汉化文件。如果更新后又变回英文，重新打开 `ClaudeCN.app`，再次点击 `一键汉化并重启 Claude` 即可。

> 产品标识：**claude-desktop-cn（macOS M5）**。

先安装依赖：

```bash
npm install
```

### 命令行一键工具（维护者）

给默认路径 `/Applications/Claude.app` 一键汉化、自动重启 Claude，并打开查看效果：

```bash
npm run cn
```

查看当前汉化/语言状态：

```bash
npm run cn -- status
```

指定 Claude.app 路径：

```bash
npm run cn -- apply --app /Applications/Claude.app
```

### 底层补丁命令（维护者调试用）

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

### 从源码构建 Swift 菜单栏应用（维护者）

Release 已经提供 `ClaudeCN.app`。如果你想从源码重新构建菜单栏应用，可以执行：

```bash
npm run menubar:build
```

生成结果：

- `dist/ClaudeCN.app`
- `dist/ClaudeCN-macos.zip`

菜单栏 App 提供：

- 一键汉化并重启 Claude。
- 选择自定义 `Claude.app` 路径后汉化。
- 检查当前汉化/语言状态。
- 打开 Claude。
- 打开运行日志。

这个 App 会把当前仓库的 `scripts/`、`data/`、`node_modules/` 和可用的 Node 运行时一起打包进去，方便其它电脑直接使用。正式开源发布流程见 `docs/open-source-release.md`。

### DMG App 安装（推荐给习惯 DMG 的用户）

如果你更习惯 DMG 安装包，可以执行这三步：

1. 下载 `Releases` 中的 `claude-desktop-cn-macos-m5-0.0.4.dmg`。
2. 打开 DMG，将 `ClaudeCN.app` 拖到 `Applications`，也可以直接双击运行。
3. 点击菜单栏里的 `一键汉化并重启 Claude`。
4. macOS 会弹出授权框，输入管理员密码即可自动完成汉化、重启 Claude，并打开查看效果。

如果你在安装后看不到变化：

- 请确认 Claude 的实际安装路径是 `/Applications/Claude.app`。
- 打开 `ClaudeCN.app` 菜单中的 `刷新状态`，确认是否已汉化。
- 如果 Claude 不在默认路径，请使用 `选择 Claude.app 后汉化…`。

### 生成 DMG（在 macOS 机器上）

```bash
npm run dist:dmg
```

脚本会生成：

- `dist/claude-desktop-cn-macos-m5-0.0.4.dmg`
- `dist/ClaudeCN-macos.zip`
- DMG 内含：`ClaudeCN.app`、`Applications` 拖拽快捷方式、`README.md`、`安装说明.txt`

### 给作者/维护者的一键发布

有 `gh` CLI 的情况下，可直接执行：

```bash
npm run release:dmg
```

它会：

- 检查工作区是否干净。
- 以版本号创建/推送 `v0.0.4` 标签。
- 运行打包并将 `dist/claude-desktop-cn-macos-m5-0.0.4.dmg` 和 `dist/ClaudeCN-macos.zip` 上传到 GitHub Releases。

## Releases 建议

当前正式 Release：

- [`v0.0.4`](https://github.com/OneBigMoon/Claude_CN/releases/tag/v0.0.4)

每个 Release 建议至少包含：

- `ClaudeCN-macos.zip`：普通用户推荐下载。
- `claude-desktop-cn-macos-m5-版本号.dmg`：兼容传统安装方式。

建议用 `v` 打头的 tag（例如 `v0.0.4`）打包发布，这样 GitHub Releases 会按版本展示下载链接。

## 补丁内容

- 覆盖 `ion-dist/i18n/zh-CN.json` 的完整中文资源。
- 补齐前端和设置页中的动态文案，例如项目页、计划任务页、侧栏、模式切换、网关配置、Claude Code、Cowork、扩展高级设置等。
- 按当前语言条件式补齐 macOS 原生菜单，中文模式显示中文菜单，英文模式保留原版英文。
- 写入 `zh-CN.lproj` / `zh_CN.lproj` 的 `InfoPlist.strings`。
- 重打包 `app.asar` 后自动更新 5 个 `Info.plist` 中的 `ElectronAsarIntegrity` hash。

## 注意

本项目不包含 Claude.app、Anthropic 官方二进制或任何商业资源，只提供本地补丁脚本和中文资源。Claude 更新后文件名和 chunk 内容可能变化，如果脚本提示某些硬编码项未命中，需要按新版本重新适配。
