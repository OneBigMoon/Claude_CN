#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="ClaudeCN"
EXECUTABLE_NAME="ClaudeCN"
APP_DIR="$ROOT_DIR/dist/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
TOOL_DIR="$RESOURCES_DIR/Claude_CN"
SOURCE_FILE="$ROOT_DIR/macos/ClaudeCNMenuBar/ClaudeCNMenuBar.swift"
INFO_PLIST="$ROOT_DIR/macos/ClaudeCNMenuBar/Info.plist"
ZIP_FILE="$ROOT_DIR/dist/$APP_NAME-macos.zip"

echo "[Claude_CN] 构建 Swift 菜单栏应用：$APP_DIR"

rm -rf "$APP_DIR" "$ZIP_FILE"
mkdir -p "$MACOS_DIR" "$TOOL_DIR"

cp "$INFO_PLIST" "$CONTENTS_DIR/Info.plist"

swiftc \
  -O \
  -framework AppKit \
  -framework Foundation \
  "$SOURCE_FILE" \
  -o "$MACOS_DIR/$EXECUTABLE_NAME"

chmod +x "$MACOS_DIR/$EXECUTABLE_NAME"

mkdir -p "$TOOL_DIR/scripts" "$TOOL_DIR/data"
rsync -a --delete "$ROOT_DIR/scripts/" "$TOOL_DIR/scripts/"
rsync -a --delete "$ROOT_DIR/data/" "$TOOL_DIR/data/"
cp "$ROOT_DIR/package.json" "$TOOL_DIR/package.json"
cp "$ROOT_DIR/README.md" "$TOOL_DIR/README.md"

if [[ -d "$ROOT_DIR/node_modules" ]]; then
  echo "[Claude_CN] 打包 node_modules"
  rsync -a --delete "$ROOT_DIR/node_modules/" "$TOOL_DIR/node_modules/"
else
  echo "[Claude_CN] 未发现 node_modules；发布前请先运行 npm install。"
fi

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  mkdir -p "$RESOURCES_DIR/node/bin"
  cp "$NODE_BIN" "$RESOURCES_DIR/node/bin/node"
  chmod +x "$RESOURCES_DIR/node/bin/node"
  echo "[Claude_CN] 已内置 Node 运行时：$NODE_BIN"
else
  echo "[Claude_CN] 未发现 node；App 会尝试使用目标电脑 PATH 中的 node。"
fi

codesign --force --deep --sign - "$APP_DIR" >/dev/null

ditto -c -k --keepParent "$APP_DIR" "$ZIP_FILE"

echo "[Claude_CN] 菜单栏应用已生成：$APP_DIR"
echo "[Claude_CN] 可发布压缩包：$ZIP_FILE"
