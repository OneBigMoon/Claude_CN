# ClaudeCN 开源发布说明

这个仓库可以同时发布两类产物：

- `DMG 安装包`：打开后直接提供 `ClaudeCN.app`，适合普通 macOS 用户。
- `Swift 菜单栏 App zip`：适合希望直接下载 `ClaudeCN.app` 压缩包的用户。

## 本地构建菜单栏 App

```bash
npm install
npm run menubar:build
```

构建结果：

- `dist/ClaudeCN.app`
- `dist/ClaudeCN-macos.zip`

菜单栏 App 会内置：

- `scripts/`
- `data/`
- `node_modules/`
- 当前机器可用的 `node` 二进制

如果目标电脑仍然提示无法运行 Node，说明构建机上的 Node 二进制不适合目标架构。建议分别在 Apple Silicon 和 Intel Mac 上各构建一份，或者后续接入官方 universal Node runtime。

## GitHub 发布建议

首次创建公开仓库时可以用：

```bash
gh repo create OneBigMoon/claude-desktop-cn --public --source=. --remote=origin --push
```

发布版本时建议同时上传 DMG 和菜单栏 App：

```bash
npm run dist:dmg
npm run menubar:build
gh release create v0.0.17 \
  dist/claude-desktop-cn-macos-m5-0.0.17.dmg \
  dist/ClaudeCN-macos.zip \
  --title "claude-desktop-cn v0.0.17" \
  --notes "Claude Desktop 中文化补丁工具，新增 Swift 菜单栏 App。"
```

## 发布前检查

- 不要上传 `Claude.app` 或 Anthropic 官方二进制。
- 不要把个人账号、Token、日志、备份目录打进发布包。
- Claude 更新后先运行 `npm run cn` 在本机确认补丁仍可用，再发布新版本。
- 如果 macOS Gatekeeper 拦截，正式发布时建议使用 Apple Developer ID 签名和 notarization；当前脚本使用的是本地 ad-hoc 签名，适合开源测试包。

## 提交说明维护规则

每次提交都要同步更新项目说明。不要只提交代码或脚本变更，否则用户无法判断当前版本是否值得更新、是否兼容自己的 Claude Desktop。

提交前需要确认：

- 功能或修复变更已经写入 `README.md` 的使用说明、补丁内容或维护约定。
- 影响发布产物时，`README.md` 和本文件里的版本号、tag、DMG 文件名保持一致。
- 影响汉化覆盖范围时，说明中写清楚新增覆盖了哪些页面、菜单、按钮或设置层级。
- 影响核心流程时，说明中写清楚是否已测试 `重新汉化`、`恢复原版`、版本判断和发布产物。
- 纯文档提交可以不发 Release；用户可见功能变更必须发布新的 GitHub Release。
