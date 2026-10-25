import matter from 'gray-matter'

export interface ParsedNote {
  title: string
  /** front-matter 标签 + 正文行内 #标签 的并集 */
  tags: string[]
  createdAt: string
  /** 正文（不含 front-matter） */
  content: string
  /** 原始 front-matter 数据（供属性索引使用） */
  data: Record<string, unknown>
}

/** 行内标签：#后面的非空白、非标点串，前面须是行首或空白 */
const INLINE_TAG_RE = /(?:^|\s)#([^\s#.,;:!?()[\]{}'"`]+)/g

export function extractInlineTags(content: string): string[] {
  const tags = new Set<string>()
  for (const m of content.matchAll(INLINE_TAG_RE)) {
    if (m[1]) tags.add(m[1])
  }
  return [...tags]
}

function firstHeading(content: string): string | null {
  const m = /^#\s+(.+)$/m.exec(content)
  return m?.[1]?.trim() || null
}

function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string')
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean)
  return []
}

/** 解析笔记文件：front-matter + 正文。front-matter 损坏时退化为纯正文。 */
export function parseNote(raw: string, fallbackTitle = '未命名'): ParsedNote {
  let data: Record<string, unknown> = {}
  let content = raw
  try {
    const parsed = matter(raw)
    data = parsed.data as Record<string, unknown>
    // gray-matter 保留 front-matter 后的前导换行，统一剥掉
    content = parsed.content.replace(/^(\r?\n)+/, '')
  } catch {
    content = raw
  }

  const fmTitle = typeof data.title === 'string' ? data.title.trim() : ''
  // 无 front-matter 标题且无 H1 时用文件名兜底（与 Obsidian 一致），避免图谱出现大量「未命名」
  const title = fmTitle || firstHeading(content) || fallbackTitle
  // YAML 会把 ISO 时间自动解析为 Date 对象
  const created = data.created
  const createdAt =
    created instanceof Date
      ? created.toISOString()
      : typeof created === 'string' && created
        ? created
        : new Date().toISOString()
  const tags = [...new Set([...toTagArray(data.tags), ...extractInlineTags(content)])]
  return { title, tags, createdAt, content, data }
}

/** 标量/数组转 YAML 字面量（够用即可，复杂结构走 JSON） */
function yamlValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (typeof item === 'string' ? JSON.stringify(item) : String(item)))
      .join(', ')}]`
  }
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value)
}

/** 序列化为带 front-matter 的 Markdown 文件内容（保留自定义属性） */
export function serializeNote(note: {
  title: string
  tags?: string[]
  createdAt: string
  content: string
  /** 额外的 front-matter 属性（自定义键值，避免编辑后丢失） */
  extra?: Record<string, unknown>
}): string {
  const lines = ['---', `title: ${JSON.stringify(note.title)}`]
  if (note.tags?.length) lines.push(`tags: [${note.tags.join(', ')}]`)
  lines.push(`created: ${note.createdAt}`)
  for (const [key, value] of Object.entries(note.extra ?? {})) {
    if (key === 'title' || key === 'tags' || key === 'created') continue
    if (value === null || value === undefined) continue
    lines.push(`${key}: ${yamlValue(value)}`)
  }
  lines.push('---', '', note.content)
  return lines.join('\n')
}

/** 标题转安全文件名：保留中文，剔除非法字符，空白转连字符。 */
export function slugify(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return cleaned || 'untitled'
}
