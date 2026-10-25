import type { DatabaseSync } from 'node:sqlite'
import type { NoteMeta, NoteSearchHit } from '../../shared/ipc'

const SNIPPET_START = '\u0001'
const SNIPPET_END = '\u0002'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** FTS snippet() 的原始输出 → 转义后把哨兵字符替换为 <mark> */
function toSnippet(raw: string): string {
  return escapeHtml(raw)
    .replace(/\u0001/g, '<mark>')
    .replace(/\u0002/g, '</mark>')
}

/** LIKE 兜底搜索时手工截取上下文并高亮 */
function buildSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return escapeHtml(content.slice(0, 80))
  const start = Math.max(0, idx - 20)
  const raw = content.slice(start, start + 100)
  const rel = idx - start
  const marked =
    escapeHtml(raw.slice(0, rel)) +
    '<mark>' +
    escapeHtml(raw.slice(rel, rel + query.length)) +
    '</mark>' +
    escapeHtml(raw.slice(rel + query.length))
  return (start > 0 ? '… ' : '') + marked + ' …'
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (ch) => '\\' + ch)
}

/**
 * NoteIndex：笔记的 SQLite 索引与全文检索。
 *  trigram 分词支持 >=3 字符的中英文子串匹配；
 *  短查询退化为 LIKE（对 FTS 表直接 SQL 查询）。
 */
export class NoteIndex {
  constructor(private readonly db: DatabaseSync) {}

  upsert(note: NoteMeta & { content: string }): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO notes (path, title, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             title = excluded.title,
             tags = excluded.tags,
             updated_at = excluded.updated_at`
        )
        .run(note.path, note.title, JSON.stringify(note.tags), note.createdAt, note.updatedAt)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(note.path)
      this.db
        .prepare('INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)')
        .run(note.path, note.title, note.content)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  remove(path: string): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(path)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(path)
      this.db.prepare('DELETE FROM note_props WHERE path = ?').run(path)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** 重建某篇笔记的属性索引 */
  setProps(path: string, props: Array<{ key: string; value: string; type: string }>): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM note_props WHERE path = ?').run(path)
      const insert = this.db.prepare(
        'INSERT OR REPLACE INTO note_props (path, key, value, value_type) VALUES (?, ?, ?, ?)'
      )
      for (const prop of props) insert.run(path, prop.key, prop.value, prop.type)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** 清空全部索引（切换 Vault 时用） */
  clearAll(): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM notes')
      this.db.exec('DELETE FROM notes_fts')
      this.db.exec('DELETE FROM note_props')
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  list(): NoteMeta[] {
    const rows = this.db
      .prepare(
        `SELECT path, title, tags, created_at, updated_at
         FROM notes ORDER BY updated_at DESC`
      )
      .all() as Array<{
      path: string
      title: string
      tags: string
      created_at: string
      updated_at: string
    }>
    return rows.map((r) => ({
      path: r.path,
      title: r.title,
      tags: parseTags(r.tags),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }

  search(query: string, limit = 30): NoteSearchHit[] {
    const q = query.trim()
    if (!q) return []

    if (q.length >= 3) {
      try {
        const pattern = `"${q.replace(/"/g, '""')}"`
        const rows = this.db
          .prepare(
            `SELECT n.path AS path, n.title AS title,
                    snippet(notes_fts, 2, ?, ?, ' … ', 32) AS snippet
             FROM notes_fts f
             JOIN notes n ON n.path = f.path
             WHERE notes_fts MATCH ?
             ORDER BY rank
             LIMIT ?`
          )
          .all(SNIPPET_START, SNIPPET_END, pattern, limit) as Array<{
          path: string
          title: string
          snippet: string
        }>
        if (rows.length > 0) {
          return rows.map((r) => ({ path: r.path, title: r.title, snippet: toSnippet(r.snippet) }))
        }
      } catch {
        // MATCH 语法异常时退化为 LIKE
      }
    }

    const like = `%${escapeLike(q)}%`
    const rows = this.db
      .prepare(
        `SELECT path, title, content FROM notes_fts
         WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
         LIMIT ?`
      )
      .all(like, like, limit) as Array<{ path: string; title: string; content: string }>
    return rows.map((r) => ({ path: r.path, title: r.title, snippet: buildSnippet(r.content, q) }))
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}
