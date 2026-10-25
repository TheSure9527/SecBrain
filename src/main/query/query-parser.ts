/**
 * 简化版 Dataview 查询语法解析（纯函数）：
 *
 * FROM #读书            或  FROM "笔记/子目录"
 * WHERE status = "未完成" AND rating >= 4
 * SORT due ASC
 * TABLE title, status, rating
 * LIMIT 20
 */

export type QueryOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'

export interface QueryCondition {
  key: string
  op: QueryOp
  value: string
}

export interface QuerySpec {
  from?: { kind: 'tag' | 'folder'; value: string }
  where: QueryCondition[]
  sort?: { key: string; dir: 'ASC' | 'DESC' }
  columns: string[]
  limit: number
}

export interface QueryParseError {
  error: string
}

const OP_RE = /^(.*?)\s*(!=|>=|<=|=|>|<|contains)\s*(.+)$/i
const KEY_RE = /^[\w\u4e00-\u9fa5.-]+$/

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseQuery(text: string): QuerySpec | QueryParseError {
  const spec: QuerySpec = { where: [], columns: ['title'], limit: 50 }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue

    const upper = line.toUpperCase()

    if (upper.startsWith('FROM ')) {
      const rest = line.slice(5).trim()
      if (rest.startsWith('#')) {
        const value = rest.slice(1).trim()
        if (!value) return { error: 'FROM # 后需要标签名' }
        spec.from = { kind: 'tag', value }
      } else {
        const value = unquote(rest).replace(/\/+$/, '')
        if (!value) return { error: 'FROM 后需要文件夹路径' }
        spec.from = { kind: 'folder', value }
      }
      continue
    }

    if (upper.startsWith('WHERE ')) {
      const clause = line.slice(6).trim()
      for (const part of clause.split(/\s+AND\s+/i)) {
        const match = OP_RE.exec(part.trim())
        if (!match) return { error: `无法解析条件：${part}` }
        const key = match[1]!.trim()
        if (!KEY_RE.test(key)) return { error: `条件字段不合法：${key}` }
        spec.where.push({
          key,
          op: match[2]!.toLowerCase() as QueryOp,
          value: unquote(match[3]!)
        })
      }
      continue
    }

    if (upper.startsWith('SORT ')) {
      const rest = line.slice(5).trim()
      const [key, dirRaw] = rest.split(/\s+/)
      if (!key) return { error: 'SORT 后需要字段名' }
      const dir = (dirRaw ?? 'ASC').toUpperCase()
      if (dir !== 'ASC' && dir !== 'DESC') return { error: `SORT 方向不合法：${dirRaw}` }
      spec.sort = { key, dir }
      continue
    }

    if (upper.startsWith('TABLE ')) {
      const columns = line
        .slice(6)
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean)
      if (columns.length === 0) return { error: 'TABLE 后需要列名' }
      // title 始终作为首列
      spec.columns = ['title', ...columns.filter((column) => column !== 'title')]
      continue
    }

    if (upper === 'LIST') {
      spec.columns = ['title']
      continue
    }

    if (upper.startsWith('LIMIT ')) {
      const value = Number.parseInt(line.slice(6).trim(), 10)
      if (!Number.isFinite(value) || value <= 0) return { error: 'LIMIT 需要正整数' }
      spec.limit = Math.min(value, 500)
      continue
    }

    return { error: `无法识别的语句：${line}` }
  }

  return spec
}
