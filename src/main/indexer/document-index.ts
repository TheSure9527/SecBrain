import type { DatabaseSync } from 'node:sqlite'
import type { DocumentIssue, DocumentStatus } from '../../shared/docs'
import type { Vault } from '../vault'
import {
  describeSkip,
  extOf,
  extractDocumentText,
  isIndexableFile,
  normalizeText
} from './doc-extract'

export interface DocumentHit {
  path: string
  title: string
  snippet: string
}

export type { DocumentStatus } from '../../shared/docs'

interface DocumentRow {
  path: string
  title: string
  text: string
  chars: number
  mtime: string
}

function titleOf(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.[^.]+$/, '')
}

function buildSnippet(text: string, query: string, radius = 60): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text.slice(0, radius * 2).replace(/\s+/g, ' ')
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + query.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ')}${suffix}`
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

/**
 * 非 Markdown 材料索引：docx / pdf / xlsx / txt / csv 等，
 * 提取正文写入 documents + documents_fts，供搜索与管家阅读。
 */
export class DocumentIndexer {
  private indexing = false
  private lastIndexedAt: string | null = null
  private issues: DocumentIssue[] = []
  private watcher: { close: () => Promise<void> } | null = null
  /** 索引变更回调（供语义索引做增量向量化） */
  private listener: { upsert?: (path: string) => void; remove?: (path: string) => void } | null = null

  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: Vault
  ) {}

  setChangeListener(listener: {
    upsert?: (path: string) => void
    remove?: (path: string) => void
  }): void {
    this.listener = listener
  }

  /** 全量重建（按 mtime 跳过未变更文件） */
  async rebuild(force = false): Promise<DocumentStatus> {
    if (this.indexing) return this.status()
    this.indexing = true
    this.issues = []
    try {
      const files = (await this.vault.listAllFiles()).filter(
        (file) => isIndexableFile(file) && !/\.md$/i.test(file)
      )
      const existing = new Map(
        (
          this.db.prepare('SELECT path, mtime FROM documents').all() as unknown as Array<{
            path: string
            mtime: string
          }>
        ).map((row) => [row.path, row.mtime])
      )

      for (const file of files) {
        try {
          const mtime = await this.vault.mtime(file)
          if (!force && existing.get(file) === mtime) continue
          await this.upsert(file, mtime)
          // upsert 提取失败时不会抛错，用库内是否存在判断
          const indexed = this.db.prepare('SELECT 1 FROM documents WHERE path = ?').get(file)
          if (!indexed) {
            const size = await this.vault.size(file).catch(() => 0)
            this.issues.push({ path: file, reason: describeSkip(extOf(file), size) })
          }
        } catch {
          this.issues.push({ path: file, reason: '读取失败（权限或文件被占用）' })
        }
      }

      // 清理已不存在的文档
      const alive = new Set(files)
      for (const path of existing.keys()) {
        if (!alive.has(path)) this.remove(path)
      }

      this.lastIndexedAt = new Date().toISOString()
    } finally {
      this.indexing = false
    }
    return this.status()
  }

  async upsert(relPath: string, knownMtime?: string): Promise<void> {
    const abs = this.vault.abs(relPath)
    const text = await extractDocumentText(abs, extOf(relPath))
    if (!text) {
      this.remove(relPath)
      return
    }
    const mtime = knownMtime ?? (await this.vault.mtime(relPath))
    const title = titleOf(relPath)
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO documents (path, ext, title, text, chars, mtime, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             ext = excluded.ext, title = excluded.title, text = excluded.text,
             chars = excluded.chars, mtime = excluded.mtime, indexed_at = excluded.indexed_at`
        )
        .run(relPath, extOf(relPath), title, text, text.length, mtime, new Date().toISOString())
      this.db.prepare('DELETE FROM documents_fts WHERE path = ?').run(relPath)
      this.db
        .prepare('INSERT INTO documents_fts (path, title, text) VALUES (?, ?, ?)')
        .run(relPath, title, text)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    // 通知语义索引增量更新
    this.listener?.upsert?.(relPath)
  }

  remove(relPath: string): void {
    this.db.prepare('DELETE FROM documents WHERE path = ?').run(relPath)
    this.db.prepare('DELETE FROM documents_fts WHERE path = ?').run(relPath)
    this.listener?.remove?.(relPath)
  }

  /** 全文检索（与笔记索引一致：>=3 字走 trigram，短词走 LIKE） */
  search(query: string, limit = 10): DocumentHit[] {
    const q = query.trim()
    if (!q) return []

    if (q.length >= 3) {
      try {
        const rows = this.db
          .prepare(
            `SELECT d.path AS path, d.title AS title, d.text AS text
             FROM documents_fts f JOIN documents d ON d.path = f.path
             WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?`
          )
          .all(`"${q.replace(/"/g, '""')}"`, limit) as unknown as DocumentRow[]
        if (rows.length > 0) {
          return rows.map((row) => ({
            path: row.path,
            title: row.title,
            snippet: buildSnippet(row.text, q)
          }))
        }
      } catch {
        // 语法异常时退化为 LIKE
      }
    }

    const like = `%${escapeLike(q)}%`
    const rows = this.db
      .prepare(
        `SELECT d.path AS path, d.title AS title, d.text AS text
         FROM documents_fts f JOIN documents d ON d.path = f.path
         WHERE f.title LIKE ? ESCAPE '\\' OR f.text LIKE ? ESCAPE '\\'
         ORDER BY d.mtime DESC LIMIT ?`
      )
      .all(like, like, limit) as unknown as DocumentRow[]
    return rows.map((row) => ({ path: row.path, title: row.title, snippet: buildSnippet(row.text, q) }))
  }

  /** 读取文档正文（供管家 read_note 兜底） */
  getText(relPath: string): { title: string; text: string } | null {
    const row = this.db
      .prepare('SELECT title, text FROM documents WHERE path = ?')
      .get(relPath) as { title: string; text: string } | undefined
    return row ? { title: row.title, text: row.text } : null
  }

  /** 按路径片段匹配（如「履历」「简历」这类目录名不在正文里） */
  searchByPath(fragment: string, limit = 10): DocumentHit[] {
    const q = fragment.trim()
    if (!q) return []
    const rows = this.db
      .prepare(
        `SELECT path, title, text FROM documents
         WHERE path LIKE ? ESCAPE '\\' ORDER BY mtime DESC LIMIT ?`
      )
      .all(`%${escapeLike(q)}%`, limit) as unknown as DocumentRow[]
    return rows.map((row) => ({
      path: row.path,
      title: row.title,
      snippet: `位于：${row.path}`
    }))
  }

  /** 路径与标题（轻量，供检索结果补标题） */
  titles(): Array<{ path: string; title: string }> {
    return this.db
      .prepare('SELECT path, title FROM documents')
      .all() as unknown as Array<{ path: string; title: string }>
  }

  /** 全部文档（语义索引用） */
  list(): Array<{ path: string; title: string; text: string }> {
    return this.db
      .prepare('SELECT path, title, text FROM documents ORDER BY mtime DESC')
      .all() as unknown as Array<{ path: string; title: string; text: string }>
  }

  status(): DocumentStatus {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as
      | { c: number }
      | undefined
    return {
      count: row?.c ?? 0,
      indexing: this.indexing,
      lastIndexedAt: this.lastIndexedAt,
      supported: ['docx', 'pdf', 'pptx', 'xlsx', 'xls', 'txt', 'csv', 'json', 'yaml', 'html'],
      issues: this.issues.slice(0, 20)
    }
  }

  /** 监听文件变更，增量更新 */
  async watch(): Promise<void> {
    if (this.watcher) return
    this.watcher = await this.vault.watch((event) => {
      if (/\.md$/i.test(event.path) || !isIndexableFile(event.path)) return
      if (event.type === 'unlink') {
        this.remove(event.path)
        return
      }
      void this.upsert(event.path)
    })
  }

  dispose(): void {
    void this.watcher?.close()
    this.watcher = null
  }
}

/** 供测试：直接归一化文本 */
export { normalizeText }
