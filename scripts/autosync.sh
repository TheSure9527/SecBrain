#!/usr/bin/env bash
# SecBrain 自动同步：有改动就提交并推送，无改动空转
# 用法：bash scripts/autosync.sh [间隔秒数]
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
INTERVAL="${1:-180}"
LOG="$REPO/.git/autosync.log"
cd "$REPO" || exit 1

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >>"$LOG"; }

log "启动自动同步（间隔 ${INTERVAL}s）"

while true; do
  # 合并/变基途中不提交，避免产生半成品
  if [ -f .git/MERGE_HEAD ] || [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    sleep "$INTERVAL"
    continue
  fi

  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    COUNT=$(git status --porcelain | wc -l | tr -d ' ')
    git add -A >>"$LOG" 2>&1 || { sleep "$INTERVAL"; continue; }
    if git commit -q -m "chore(auto): 同步 ${COUNT} 个文件变更

由 scripts/autosync.sh 自动提交（$(date '+%Y-%m-%d %H:%M:%S')）" >>"$LOG" 2>&1; then
      if git push -q origin HEAD >>"$LOG" 2>&1; then
        log "已推送：${COUNT} 个文件"
      else
        log "推送失败（本地已提交，稍后重试）"
      fi
    else
      log "提交失败（可能有冲突或钩子拦截）"
    fi
  fi

  sleep "$INTERVAL"
done
