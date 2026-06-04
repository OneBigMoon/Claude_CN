#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('./package.json').version")"
APP_NAME="claude-desktop-cn-macos-m5"
DMG_NAME="${APP_NAME}-${VERSION}.dmg"
OUTPUT_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${OUTPUT_DIR}/stage"
INSTALLER="${ROOT_DIR}/claude-desktop-cn-installer.command"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-dmg 仅支持在 macOS 上运行（需要 hdiutil）。" >&2
  exit 1
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "未检测到 hdiutil，当前环境不能生成 DMG。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 node，请先安装 Node.js。" >&2
  exit 1
fi

if [[ ! -x "$INSTALLER" ]]; then
  echo "未找到安装脚本：$INSTALLER" >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "未检测到 node_modules。请先执行 npm install。" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$STAGE_DIR"

cp "$ROOT_DIR/README.md" "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/claude-desktop-cn-installer.command" "$STAGE_DIR/"
cp -R "$ROOT_DIR/scripts" "$ROOT_DIR/data" "$ROOT_DIR/node_modules" "$STAGE_DIR/"

chmod +x "$STAGE_DIR/claude-desktop-cn-installer.command"

cp "$STAGE_DIR/claude-desktop-cn-installer.command" "$STAGE_DIR/Claude_CN_Installer.command"

cat > "$STAGE_DIR/安装说明.txt" <<'EOF'
claude-desktop-cn（macOS M5）全部汉化版本

1) 双击 claude-desktop-cn-installer.command
2) 输入管理员密码
3) 自动汉化、重启 Claude，并打开查看效果

路径参数已默认使用 /Applications/Claude.app，
如你的 Claude 安装在其他位置，请手动运行以下命令：

node scripts/claude-cn.mjs apply --app /你的/Claude.app
EOF

hdiutil create \
  -srcfolder "$STAGE_DIR" \
  -volname "claude-desktop-cn macOS M5" \
  -fs HFS+ \
  -format UDZO \
  "$OUTPUT_DIR/$DMG_NAME"

rm -rf "$STAGE_DIR"

echo "已生成：$OUTPUT_DIR/$DMG_NAME"
