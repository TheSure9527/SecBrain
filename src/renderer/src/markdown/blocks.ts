/**
 * 把 Markdown 源码切成"可独立渲染、可独立编辑"的块。
 *
 * 规则：
 * - 空行分块；
 * - 围栏代码块（``` / ~~~）内部的空行不分块；
 * - front-matter（开头 --- ... ---）单独作为一块，避免正文首屏被吞掉。
 *
 * 每块都带源码偏移，预览栏就地编辑时按偏移替换即可精确回写。
 */
export interface MarkdownBlock {
  start: number
  end: number
  raw: string
}

const FENCE_RE = /^\s{0,3}(```+|~~~+)/

export function splitBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let cursor = 0

  // front-matter 单独成块
  if (content.startsWith('---\n')) {
    const close = content.indexOf('\n---', 3)
    if (close > 0) {
      const end = content.indexOf('\n', close + 4)
      const fmEnd = end === -1 ? content.length : end + 1
      blocks.push({ start: 0, end: fmEnd, raw: content.slice(0, fmEnd) })
      cursor = fmEnd
    }
  }

  let fence: string | null = null
  let blockStart = -1
  let lastContentEnd = cursor

  const flush = (endExclusive: number): void => {
    if (blockStart < 0) return
    const raw = content.slice(blockStart, endExclusive)
    if (raw.trim()) blocks.push({ start: blockStart, end: endExclusive, raw })
    blockStart = -1
  }

  let lineStart = cursor
  while (lineStart <= content.length) {
    const newline = content.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(lineStart, lineEnd)
    const nextStart = newline === -1 ? content.length + 1 : newline + 1

    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1]!
        if (blockStart < 0) blockStart = lineStart
      } else if (line.trim().startsWith(fence)) {
        fence = null
      }
    }

    if (fence === null) {
      if (line.trim() === '') {
        flush(lineStart)
      } else {
        if (blockStart < 0) blockStart = lineStart
        lastContentEnd = nextStart
      }
    } else if (blockStart < 0) {
      blockStart = lineStart
    }

    if (newline === -1) break
    lineStart = nextStart
  }

  flush(Math.max(lastContentEnd, blockStart))
  return blocks
}
