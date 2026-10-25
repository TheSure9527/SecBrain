#!/usr/bin/env bash
# 把 autosync.sh 装成登录自启的 launchd 服务
# 用法：bash scripts/install-autosync.sh [间隔秒数，默认 180]
# 卸载：bash scripts/uninstall-autosync.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
INTERVAL="${1:-180}"
LABEL="com.secbrain.autosync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/autosync.sh</string>
    <string>$INTERVAL</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$REPO/.git/autosync.out</string>
  <key>StandardErrorPath</key><string>$REPO/.git/autosync.err</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "✅ 已安装并启动：$LABEL（每 ${INTERVAL}s 检查一次）"
echo "   日志：$REPO/.git/autosync.log"
echo "   停止：launchctl bootout gui/$(id -u)/$LABEL"
