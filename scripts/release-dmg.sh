#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
DMG_NAME="claude-desktop-cn-macos-m5-${VERSION}.dmg"
DMG_PATH="${ROOT_DIR}/dist/${DMG_NAME}"
MENUBAR_ZIP_NAME="ClaudeCN-macos.zip"
MENUBAR_ZIP_PATH="${ROOT_DIR}/dist/${MENUBAR_ZIP_NAME}"
RAW_REMOTE="$(git -C "$ROOT_DIR" remote get-url origin)"
GH_REPO="${RAW_REMOTE#https://github.com/}"
GH_REPO="${GH_REPO#git@github.com:}"
GH_REPO="${GH_REPO%.git}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "release-dmg 仅支持在 macOS 上运行。" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "未检测到 gh，请先安装 GitHub CLI（brew install gh）后再运行此脚本。" >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" diff --quiet || [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no)" ]]; then
  echo "当前有未提交改动，发布前请先提交再继续。" >&2
  exit 1
fi

git -C "$ROOT_DIR" checkout --quiet main
git -C "$ROOT_DIR" pull --ff-only

if ! git -C "$ROOT_DIR" rev-parse "$TAG" >/dev/null 2>&1; then
  git -C "$ROOT_DIR" tag "$TAG"
  git -C "$ROOT_DIR" push origin "$TAG"
fi

bash "${ROOT_DIR}/scripts/build-dmg.sh"
bash "${ROOT_DIR}/scripts/build-menubar-app.sh"

if gh -R "$GH_REPO" release view "$TAG" >/dev/null 2>&1; then
  gh -R "$GH_REPO" release upload "$TAG" "$DMG_PATH" "$MENUBAR_ZIP_PATH" --clobber
else
  gh -R "$GH_REPO" release create "$TAG" "$DMG_PATH" "$MENUBAR_ZIP_PATH" \
    --title "claude-desktop-cn macOS M5 全部汉化版本 ${TAG}" \
    --notes "claude-desktop-cn macOS M5 全部汉化版本 ${TAG}。

包含产物：
- ${DMG_NAME}：传统 DMG 安装包。
- ${MENUBAR_ZIP_NAME}：Swift 菜单栏应用 ClaudeCN.app。

推荐普通用户下载 ${MENUBAR_ZIP_NAME}，解压后运行 ClaudeCN.app。
"
fi

echo "发布完成：${TAG}"
