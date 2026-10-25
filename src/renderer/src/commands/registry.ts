import { useSyncExternalStore } from 'react'

export interface Command {
  id: string
  title: string
  section?: string
  shortcut?: string
  run: () => void
}

let commands: Command[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 全量替换命令表（App 挂载时注册），返回注销函数 */
export function registerCommands(next: Command[]): () => void {
  commands = next
  emit()
  return () => {
    commands = []
    emit()
  }
}

export function useCommands(): Command[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => commands
  )
}

/** 简单模糊匹配：子序列匹配 + 连续命中加分；返回 null 表示不匹配 */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let score = 0
  let ti = 0
  let lastMatch = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    score += found === lastMatch + 1 ? 3 : 1
    lastMatch = found
    ti = found + 1
  }
  // 短目标词权重更高（标题短的更相关）
  return score + Math.max(0, 30 - target.length) / 10
}

export function filterCommands(query: string, list: Command[]): Command[] {
  if (!query.trim()) return list
  return list
    .map((cmd) => ({ cmd, score: fuzzyScore(query, cmd.title) }))
    .filter((item): item is { cmd: Command; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.cmd)
}
