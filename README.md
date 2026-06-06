# claude-desktop-cn（macOS M5）

**claude-desktop-cn（macOS M5）是 Claude Desktop 全部汉化版本。**
面向 Claude Desktop / Claude Code / Cowork / 第三方推理配置 / macOS 菜单做了全量中文化补齐，目标是尽量把界面常见英文残留清理到位。

当前作者：`OneBigMoon`

当前作者版本号：`v0.0.18`

当前已适配 Claude Desktop：`1.10628.x`

如果 Claude Desktop 更新到新的大版本，本工具会在执行汉化前做版本判断。未适配版本默认不会继续汉化，避免 Claude 更新后结构变化导致汉化不完整或应用损坏。维护者确认后可用 `--force` 强制尝试。

当前维护者说明：本人是 M5 的笔记本，在 M4 上测试没有问题。M5 上遇到了一些奇奇怪怪的问题，于是参考大神的代码进行调整，并把遗漏的页面、菜单和硬编码文本继续补齐。

## 当前本地验收状态

最近一次本地验收：`2026-06-04`

验收环境：

- Claude Desktop：`1.10628.2`
- ClaudeCN：`v0.0.18`
- macOS：Apple Silicon 机器

已验收流程：

- 从隔离的 Claude.app 副本恢复到未汉化状态。
- 从未汉化状态重新执行一键汉化。
- 汉化后状态识别为已汉化，`Claude` 和 `Claude-3p` locale 均为 `zh-CN`。
- 汉化后的 Claude.app 通过 `codesign --verify --deep --strict`。
- 再次恢复原版后，状态识别为未汉化，locale 回到 `en-US`。
- 从 GitHub Release 重新下载 `claude-desktop-cn-macos-m5-0.0.18.dmg`，可以正常挂载，内部包含 `ClaudeCN.app`、`Applications` 快捷方式、`README.md` 和 `安装说明.txt`。

验收注意：

- 官方 `https://claude.ai/download` 是下载页，不是直接 DMG 文件；命令行直接请求官方 latest redirect 接口可能返回 `403`。全新安装 Claude Desktop 时，建议普通用户从浏览器打开官方页面下载。
- 使用自定义 Claude.app 路径做测试时，Claude 的语言配置仍然是当前 macOS 用户级配置。因此测试临时 App 后，如果需要继续使用真实 `/Applications/Claude.app` 的中文模式，请再对真实 Claude 执行一次 `重新汉化`。

## 特别致谢

特别致谢并致敬 [Win-Hao/ClaudeCN](https://github.com/Win-Hao/ClaudeCN)。原项目提供了 Claude Desktop 汉化的早期思路和实践基础，本项目在此基础上整理为更完整的补丁流程，并继续补齐 Claude Code、Cowork、第三方推理配置、页面空状态和 macOS 菜单等遗漏。

## 使用方法

### 普通用户下载哪个文件？

当前正式版本：[`v0.0.18`](https://github.com/OneBigMoon/Claude_CN/releases/tag/v0.0.18)

推荐下载：

- `ClaudeCN-macos.zip`：解压后得到 `ClaudeCN.app`，这是推荐给普通用户的菜单栏应用。
- `claude-desktop-cn-macos-m5-0.0.18.dmg`：App 型 DMG，打开后可直接运行或拖拽安装 `ClaudeCN.app`。
- 源码包：适合维护者、开发者和想自己适配新 Claude 版本的人。

### ClaudeCN.app 使用方式（推荐）

1. 从 `Releases` 下载 `ClaudeCN-macos.zip`。
2. 解压后得到 `ClaudeCN.app`，可以拖到 `/Applications`。
3. 打开 `ClaudeCN.app`，菜单栏会出现 `ClaudeCN`。
4. 点击菜单栏里的 `一键汉化并重启 Claude`。
5. 如果 Claude 不在默认路径 `/Applications/Claude.app`，请选择 `选择 Claude.app 后汉化…`。

菜单栏应用包含这些功能：

- 一键汉化并重启 Claude。
- 判断当前 Claude Desktop 版本是否在已适配范围内。
- 选择自定义 `Claude.app` 路径后汉化。
- 授权失败、权限不足、路径错误、版本不适配时显示中文原因和处理建议。
- 失败弹窗可直接打开日志，方便排查。
- 检查当前汉化/语言状态。
- 在线检查 ClaudeCN 最新 Release，并打开下载页面。
- 从最近一次备份恢复原版，并清理新增中文资源和语言配置。
- 点击作者名称打开 GitHub 项目主页。
- 打开 Claude。
- 打开运行日志。
- 打开项目主页。

首次打开时，如果 macOS 提示“无法验证开发者”：

- 右键点击 `ClaudeCN.app`，选择 `打开`。
- 或进入 `系统设置 > 隐私与安全性`，允许打开该应用。

执行汉化时，macOS 可能会要求输入管理员密码。这是因为工具需要修改 `/Applications/Claude.app`、重打包 `app.asar`、重签名并重启 Claude。工具不会上传你的 Claude 数据、账号信息或聊天内容。

### 授权和常见错误

`ClaudeCN.app` 会在需要修改 Claude Desktop 时调用 macOS 管理员授权。遇到问题时可以按下面处理：

- 如果你取消了授权弹窗：不会修改 Claude，重新点击 `重新汉化` 或 `恢复原版` 即可。
- 如果提示密码错误或授权失败：请使用本机管理员账号密码，不是 Claude 账号密码。
- 如果提示权限不足：请确认 Claude Desktop 安装在 `/Applications/Claude.app`，并在操作前退出 Claude。
- 如果 Claude 不在默认路径：点击底部 `选择 Claude`，手动选择 Claude Desktop 官方 App。
- 如果提示版本未适配：说明当前 Claude Desktop 版本不在 `1.10628.x` 范围内，请等待 ClaudeCN 更新。
- 如果仍然失败：在错误弹窗中点击 `打开日志`，查看 `~/Library/Logs/ClaudeCN.log`。

Claude Desktop 更新后，官方更新可能会覆盖已汉化文件。如果更新后又变回英文，重新打开 `ClaudeCN.app`，再次点击 `一键汉化并重启 Claude` 即可。

如果 ClaudeCN 提示当前 Claude Desktop 版本未适配，请先等待项目更新。不要盲目强制汉化，除非你愿意承担新版本结构变化带来的风险。

在线更新说明：

- `ClaudeCN.app` 会检查 GitHub Releases 的最新版本。
- 如果发现新版本，点击更新提示会打开最新 Release 页面。
- 当前版本不做静默自更新，因为 macOS 对替换正在运行的 App、签名和安全校验有较严格限制。后续如接入 Sparkle 和 Developer ID 签名，可升级为完整自动更新。

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

如果当前 Claude Desktop 版本未适配，命令会停止执行。确认要强制尝试时：

```bash
npm run cn -- apply --force
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

构建脚本会把 Swift/Clang 模块缓存写入 `dist/swift-module-cache`，避免某些电脑因为 `~/.cache/clang` 权限不可写导致构建失败。

### DMG App 安装（推荐给习惯 DMG 的用户）

如果你更习惯 DMG 安装包，可以执行这三步：

1. 下载 `Releases` 中的 `claude-desktop-cn-macos-m5-0.0.18.dmg`。
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

- `dist/claude-desktop-cn-macos-m5-0.0.18.dmg`
- `dist/ClaudeCN-macos.zip`
- DMG 内含：`ClaudeCN.app`、`Applications` 拖拽快捷方式、`README.md`、`安装说明.txt`

### 给作者/维护者的一键发布

有 `gh` CLI 的情况下，可直接执行：

```bash
npm run release:dmg
```

它会：

- 检查工作区是否干净。
- 以版本号创建/推送 `v0.0.18` 标签。
- 运行打包并将 `dist/claude-desktop-cn-macos-m5-0.0.18.dmg` 和 `dist/ClaudeCN-macos.zip` 上传到 GitHub Releases。

## Releases 建议

当前正式 Release：

- [`v0.0.18`](https://github.com/OneBigMoon/Claude_CN/releases/tag/v0.0.18)

每个 Release 建议至少包含：

- `ClaudeCN-macos.zip`：普通用户推荐下载。
- `claude-desktop-cn-macos-m5-版本号.dmg`：兼容传统安装方式。

建议用 `v` 打头的 tag（例如 `v0.0.18`）打包发布，这样 GitHub Releases 会按版本展示下载链接。

## 维护约定

后续每次提交都必须同步更新项目说明，避免代码已经变了但用户不知道该下载哪个版本、适配哪个 Claude Desktop、这次具体修了什么。

每次功能或修复提交至少检查并更新这些内容：

- `README.md` 中的当前作者版本号、正式版本链接、DMG 文件名和适配 Claude Desktop 版本。
- `docs/open-source-release.md` 中的发布命令、发布前检查和 Release 说明。
- 如果补齐了新的汉化页面或按钮，需要在说明中写明本次覆盖的范围。
- 如果修改了恢复原版、重新汉化、版本判断、在线更新等核心能力，需要写明本地测试结果。
- 如果只是内部文档维护，可以不发布新 Release；如果影响用户下载使用，则需要同步生成新的 tag、DMG 和 zip。

## 补丁内容

- 覆盖 `ion-dist/i18n/zh-CN.json` 的完整中文资源。
- 补齐前端和设置页中的动态文案，例如项目页、计划任务页、侧栏、模式切换、网关配置、Claude Code、Cowork、扩展高级设置等。
- 按当前语言条件式补齐 macOS 原生菜单，中文模式显示中文菜单，英文模式保留原版英文。
- 补齐菜单栏工具的授权错误、权限不足、路径选择、版本不适配、包不完整等中文提示。
- 写入 `zh-CN.lproj` / `zh_CN.lproj` 的 `InfoPlist.strings`。
- 重打包 `app.asar` 后自动更新 5 个 `Info.plist` 中的 `ElectronAsarIntegrity` hash。

## 注意

本项目不包含 Claude.app、Anthropic 官方二进制或任何商业资源，只提供本地补丁脚本和中文资源。Claude 更新后文件名和 chunk 内容可能变化，如果脚本提示某些硬编码项未命中，需要按新版本重新适配。
