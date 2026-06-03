#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${CLAUDE_CN_NODE_BIN:-$(command -v node 2>/dev/null || true)}"
PATCHER="${ROOT_DIR}/scripts/patch-claude-cn.mjs"
CLAUDE_APP_PATH="${1:-/Applications/Claude.app}"

if [[ -z "$NODE_BIN" ]]; then
  osascript -e 'display dialog "未检测到 node，请先安装 Node.js（建议 22+）" with title "claude-desktop-cn（macOS M5）安装" with icon stop buttons {"确定"}'
  exit 1
fi

if [[ ! -f "$PATCHER" ]]; then
  osascript -e 'display dialog "未找到补丁脚本，请重新下载 DMG 后再试。" with title "claude-desktop-cn（macOS M5）安装" with icon stop buttons {"确定"}'
  exit 1
fi

osascript <<OSA
set quotedRoot to quoted form of "$ROOT_DIR"
set quotedNode to quoted form of "$NODE_BIN"
set quotedScript to quoted form of "$PATCHER"
set quotedApp to quoted form of "$CLAUDE_APP_PATH"
do shell script "cd " & quotedRoot & " && " & quotedNode & " " & quotedScript & " --app " & quotedApp & " --restart" with administrator privileges
OSA

osascript -e 'display dialog "claude-desktop-cn（macOS M5）全部汉化补丁已执行完毕。若 Claude 未自动重启，请手动启动 Claude.app。" with title "claude-desktop-cn 安装完成" with icon note buttons {"完成"}'
