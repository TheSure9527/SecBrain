import type { DatabaseSync } from 'node:sqlite'
import type { QueryResult } from '../../shared/query'
import { parseQuery, type QueryCondition } from './query-parser'

interface NoteRow {
  path: string
  title: string
  tags: string
  updated_at: string
}

interface PropRow {
  path: string
  key: string
  value: string
}

function toNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

/**
 * 查询执行器：从 notes + note_props 取数，内存过滤排序。
 * 个人库规模（千级）下无需复杂 SQL。
 */
export class QueryExecutor {
  constructor(private readonly db: DatabaseSync) {}

  run(text: string): QueryResult {
    const spec = parseQuery(text)
    if ('error' in spec) {
      return { columns: [], rows: [], error: spec.error }
    }

    const notes = (
      this.db.prepare('SELECT path, title, tags, updated_at FROM notes').all() as unknown as NoteRow[]
    ).filter((note) => {
      if (spec.from?.kind === 'tag') {
        const tags: string[] = (() => {
          try {
            const parsed: unknown = JSON.parse(note.tags)
            return Array.isArray(parsed) ? parsed.map(String) : []
          } catch {
            return []
          }
        })()
        return tags.includes(spec.from.value)
      }
      if (spec.from?.kind === 'folder') {
        return note.path.startsWith(`${spec.from.value}/`)
      }
      return true
    })

    const props = new Map<string, Map<string, string>>()
    for (const row of this.db
      .prepare('SELECT path, key, value FROM note_props')
      .all() as unknown as PropRow[]) {
      let map = props.get(row.path)
      if (!map) {
        map = new Map()
        props.set(row.path, map)
      }
      map.set(row.key, row.value)
    }

    const valueOf = (note: NoteRow, key: string): string => {
      if (key === 'title') return note.title
      if (key === 'path') return note.path
      if (key === 'updated') return note.updated_at
      return props.get(note.path)?.get(key) ?? ''
    }

    const matches = (note: NoteRow, condition: QueryCondition): boolean => {
      const actual = valueOf(note, condition.key)
      const expected = condition.value
      if (condition.op === 'contains') {
        return actual.toLowerCase().includes(expected.toLowerCase())
      }
      if (condition.op === '=') {
        const a = toNumber(actual)
        const b = toNumber(expected)
        return a !== null && b !== null ? a === b : actual === expected
      }
      if (condition.op === '!=') {
        const a = toNumber(actual)
        const b = toNumber(expected)
        return a !== null && b !== null ? a !== b : actual !== expected
      }
      // 数值比较；任一非数字时按字符串比较
      const a = toNumber(actual)
      const b = toNumber(expected)
      if (a !== null && b !== null) {
        switch (condition.op) {
          case '>':
            return a > b
          case '<':
            return a < b
          case '>=':
            return a >= b
          case '<=':
            return a <= b
          default:
            return false
        }
      }
      const cmp = actual.localeCompare(expected, 'zh-CN')
      switch (condition.op) {
        case '>':
          return cmp > 0
        case '<':
          return cmp < 0
        case '>=':
          return cmp >= 0
        case '<=':
          return cmp <= 0
        default:
          return false
      }
    }

    let rows = notes.filter((note) => spec.where.every((condition) => matches(note, condition)))

    if (spec.sort) {
      const { key, dir } = spec.sort
      rows = [...rows].sort((a, b) => {
        const va = valueOf(a, key)
        const vb = valueOf(b, key)
        const na = toNumber(va)
        const nb = toNumber(vb)
        const cmp =
          na !== null && nb !== null ? na - nb : va.localeCompare(vb, 'zh-CN')
        return dir === 'DESC' ? -cmp : cmp
      })
    }

    rows = rows.slice(0, spec.limit)

    return {
      columns: spec.columns,
      rows: rows.map((note) => {
        const row: Record<string, string> = {}
        for (const column of spec.columns) {
          row[column] = valueOf(note, column)
        }
        return row
      })
    }
  }
}
