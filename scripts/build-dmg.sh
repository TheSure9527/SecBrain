#!/usr/bin/env bash
# 一键打包 macOS dmg（免登录、未签名，双击可开）
# 用法：bash scripts/build-dmg.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ 1/3 类型检查"
npm run typecheck

echo "▶ 2/3 构建 main / preload / renderer"
npm run build

echo "▶ 3/3 打包 dmg（arm64）"
npx electron-builder --mac dmg --arm64

echo
echo "✅ 产物："
ls -lh dist/*.dmg
echo
echo "安装：双击 dmg → 把 SecBrain 拖到「应用程序」"
echo "首次打开若被系统拦截：右键 App →「打开」，或在终端执行"
echo "  xattr -dr com.apple.quarantine /Applications/SecBrain.app"
echo
echo "数据位置：~/Library/Application Support/SecBrain/secbrain.db（首次启动自动从旧 secbrain 目录迁移）"
