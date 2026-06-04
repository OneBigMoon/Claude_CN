#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('./package.json').version")"
APP_NAME="claude-desktop-cn-macos-m5"
DMG_NAME="${APP_NAME}-${VERSION}.dmg"
OUTPUT_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${OUTPUT_DIR}/stage"
MENUBAR_APP="${OUTPUT_DIR}/ClaudeCN.app"

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

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "未检测到 node_modules。请先执行 npm install。" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

bash "$ROOT_DIR/scripts/build-menubar-app.sh"

if [[ ! -d "$MENUBAR_APP" ]]; then
  echo "未生成菜单栏应用：$MENUBAR_APP" >&2
  exit 1
fi

mkdir -p "$STAGE_DIR"

cp -R "$MENUBAR_APP" "$STAGE_DIR/ClaudeCN.app"
cp "$ROOT_DIR/README.md" "$STAGE_DIR/README.md"
ln -s /Applications "$STAGE_DIR/Applications"

cat > "$STAGE_DIR/安装说明.txt" <<EOF
claude-desktop-cn（macOS M5）全部汉化版本

推荐使用方式：

1) 将 ClaudeCN.app 拖入右侧 Applications。
2) 打开 ClaudeCN.app，菜单栏会出现 ClaudeCN。
3) 点击“一键汉化并重启 Claude”。
4) 输入管理员密码后，工具会自动汉化、重启 Claude，并打开查看效果。

也可以直接双击 ClaudeCN.app 运行。

如果 macOS 提示无法验证开发者：

1) 右键点击 ClaudeCN.app。
2) 选择“打开”。
3) 再次确认打开。

如果 Claude 不在 /Applications/Claude.app：

请在菜单栏中选择“选择 Claude.app 后汉化…”。
EOF

hdiutil create \
  -srcfolder "$STAGE_DIR" \
  -volname "claude-desktop-cn macOS M5" \
  -fs HFS+ \
  -format UDZO \
  "$OUTPUT_DIR/$DMG_NAME"

rm -rf "$STAGE_DIR"

echo "已生成：$OUTPUT_DIR/$DMG_NAME"
