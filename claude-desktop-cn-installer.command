#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${CLAUDE_CN_NODE_BIN:-$(command -v node 2>/dev/null || true)}"
TOOL="${ROOT_DIR}/scripts/claude-cn.mjs"
CLAUDE_APP_PATH="${1:-/Applications/Claude.app}"

if [[ -z "$NODE_BIN" ]]; then
  osascript -e 'display dialog "未检测到 node，请先安装 Node.js（建议 22+）" with title "claude-desktop-cn（macOS M5）安装" with icon stop buttons {"确定"}'
  exit 1
fi

if [[ ! -f "$TOOL" ]]; then
  osascript -e 'display dialog "未找到一键工具脚本，请重新下载 DMG 后再试。" with title "claude-desktop-cn（macOS M5）安装" with icon stop buttons {"确定"}'
  exit 1
fi

osascript <<OSA
set quotedRoot to quoted form of "$ROOT_DIR"
set quotedNode to quoted form of "$NODE_BIN"
set quotedTool to quoted form of "$TOOL"
set quotedApp to quoted form of "$CLAUDE_APP_PATH"
do shell script "cd " & quotedRoot & " && " & quotedNode & " " & quotedTool & " apply --app " & quotedApp with administrator privileges
OSA

osascript -e 'display dialog "claude-desktop-cn（macOS M5）一键汉化已执行完毕。Claude 会自动重启并打开供你查看效果。" with title "claude-desktop-cn 安装完成" with icon note buttons {"完成"}'
