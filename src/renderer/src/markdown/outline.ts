/** 从 Markdown 内容提取标题大纲（跳过代码块） */

export interface Heading {
  level: number
  text: string
  /** 1-based 行号 */
  line: number
}

export function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = []
  let inFence = false
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) {
      headings.push({
        level: match[1]!.length,
        text: match[2]!.trim(),
        line: index + 1
      })
    }
  })

  return headings
}
