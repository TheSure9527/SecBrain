/** Markdown 分块（纯函数）：按标题/段落切分，保留重叠上下文 */

export interface Chunk {
  index: number
  text: string
}

const MAX_CHARS = 750
const OVERLAP_CHARS = 80

/** 按句号类标点切分超长段落 */
function splitSentences(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[。！？!?；;\n])/).filter((s) => s.trim())
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current) {
      out.push(current)
      current = ''
    }
    current += sentence
  }
  if (current.trim()) out.push(current)
  return out
}

/**
 * 把笔记正文切成若干块：
 * - 去掉 front-matter（调用方传入的应是纯正文）
 * - 优先按空行分段，超长段落按句子再切
 * - 相邻块保留最后 80 字符作为重叠，避免语义被生硬截断
 */
export function chunkMarkdown(content: string, maxChars = MAX_CHARS): Chunk[] {
  const text = content.replace(/^---[\s\S]*?---\n/, '').trim()
  if (!text) return []

  const paragraphs = text.split(/\n{2,}/)
  const pieces: string[] = []
  let buffer = ''

  const flush = (): void => {
    if (buffer.trim()) {
      pieces.push(buffer.trim())
      buffer = ''
    }
  }

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue
    if (trimmed.length > maxChars) {
      flush()
      pieces.push(...splitSentences(trimmed, maxChars).map((s) => s.trim()))
      continue
    }
    if (buffer.length + trimmed.length + 2 > maxChars) flush()
    buffer += (buffer ? '\n\n' : '') + trimmed
  }
  flush()

  const chunks: Chunk[] = []
  let previousTail = ''
  pieces.forEach((piece, index) => {
    const withOverlap = previousTail ? `${previousTail}\n\n${piece}` : piece
    chunks.push({ index, text: withOverlap.slice(0, maxChars + OVERLAP_CHARS) })
    previousTail = piece.slice(-OVERLAP_CHARS)
  })

  return chunks
}

/** 生成用于展示的短摘录（去 Markdown 标记） */
export function excerpt(text: string, maxChars = 160): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxChars ? `${plain.slice(0, maxChars)}…` : plain
}
