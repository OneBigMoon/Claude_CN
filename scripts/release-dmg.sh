#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
DMG_NAME="claude-desktop-cn-macos-m5-${VERSION}.dmg"
DMG_PATH="${ROOT_DIR}/dist/${DMG_NAME}"
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

if gh -R "$GH_REPO" release view "$TAG" >/dev/null 2>&1; then
  gh -R "$GH_REPO" release upload "$TAG" "$DMG_PATH" --clobber
else
  gh -R "$GH_REPO" release create "$TAG" "$DMG_PATH" \
    --title "claude-desktop-cn macOS M5 ${TAG}" \
    --notes "claude-desktop-cn macOS M5 中文补丁 ${TAG}。

下载链接：dist/${DMG_NAME}
直接解压后双击 claude-desktop-cn-installer.command 即可。
"
fi

echo "发布完成：${TAG}"
