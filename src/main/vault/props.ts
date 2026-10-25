/** front-matter 属性提取（供 Dataview 式查询使用） */

export type PropValueType = 'string' | 'number' | 'boolean' | 'date' | 'array'

export interface NoteProp {
  key: string
  /** 统一转成字符串存储；数组存 JSON */
  value: string
  type: PropValueType
}

const RESERVED_KEYS = new Set(['title', 'tags'])

/** 用户输入的属性值 → 合适类型（数字/布尔/数组/字符串） */
export function parsePropInput(raw: string): number | boolean | string[] | string {
  const value = raw.trim()
  if (!value) return ''
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // 非 JSON 数组：按逗号分割
      const items = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      return items
    }
  }
  return value
}

/** 从 front-matter 数据中提取可查询属性（跳过 title/tags 与空值） */
export function extractProps(data: Record<string, unknown>): NoteProp[] {
  const out: NoteProp[] = []
  for (const [key, raw] of Object.entries(data)) {
    if (RESERVED_KEYS.has(key)) continue
    if (raw === null || raw === undefined) continue
    if (raw instanceof Date) {
      out.push({ key, value: raw.toISOString(), type: 'date' })
      continue
    }
    if (Array.isArray(raw)) {
      out.push({ key, value: JSON.stringify(raw.map(String)), type: 'array' })
      continue
    }
    if (typeof raw === 'number') {
      out.push({ key, value: String(raw), type: 'number' })
      continue
    }
    if (typeof raw === 'boolean') {
      out.push({ key, value: String(raw), type: 'boolean' })
      continue
    }
    if (typeof raw === 'string') {
      out.push({ key, value: raw, type: 'string' })
      continue
    }
    // 嵌套对象等复杂结构：JSON 字符串化，类型记为 string
    try {
      out.push({ key, value: JSON.stringify(raw), type: 'string' })
    } catch {
      // 忽略不可序列化值
    }
  }
  return out
}
