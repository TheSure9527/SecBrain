import type { DatabaseSync } from 'node:sqlite'
import type { BacklinkInfo, GraphData, GraphEdge, GraphNode, UnlinkedMention } from '../../shared/links'
import type { Vault } from './vault'
import type { NoteIndex } from './note-index'

export interface LinkRef {
  /** 链接目标原文（可能是标题、文件名或路径） */
  target: string
  kind: 'link' | 'embed'
}

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g
/** Markdown 链接：![alt](path.md)、[text](path.md#anchor "title")、[text](<path with space.md>) */
const MDLINK_RE = /(!?)\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g

function dirOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/** POSIX 规范化（处理 . 与 ..） */
function normalizePosix(path: string): string {
  const parts = path.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** 允许被链接的本地文件扩展名（笔记与常见附件） */
const LINKABLE_EXT_RE =
  /\.(md|markdown|png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf|mp4|webm|mov|m4v|mp3|wav|m4a|aac|flac|ogg|docx?|xlsx?|pptx?|csv|txt|json|yaml|yml|zip|rar|7z|pages|numbers|key)$/i

/**
 * 从 Markdown 正文提取链接：
 * - `[[目标]]` / `![[嵌入]]`（支持 |别名 与 #标题；目标可为笔记或任意附件）
 * - `[文本](路径)`（相对路径按来源笔记目录解析，支持 #锚点；笔记与附件均可）
 * 外链（http/mailto 等）与非文件锚点不计入。
 */
export function extractLinks(content: string, sourcePath = ''): LinkRef[] {
  const seen = new Set<string>()
  const out: LinkRef[] = []
  // 移除代码块与行内代码，避免把示例中的链接当成真实链接
  const cleaned = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')

  for (const match of cleaned.matchAll(WIKILINK_RE)) {
    const kind: LinkRef['kind'] = match[1] === '!' ? 'embed' : 'link'
    const raw = match[2]!.trim()
    if (!raw) continue
    const target = raw.split('|')[0]!.split('#')[0]!.trim()
    if (!target) continue
    const key = `${kind}:${target.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ target, kind })
  }

  for (const match of cleaned.matchAll(MDLINK_RE)) {
    const kind: LinkRef['kind'] = match[1] === '!' ? 'embed' : 'link'
    let raw = match[3]!.trim().replace(/^<|>$/g, '')
    if (!raw) continue
    // 去掉锚点与 query
    raw = raw.split('#')[0]!.split('?')[0]!.trim()
    if (!raw) continue
    // 跳过外部链接与绝对协议
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue
    // 只认本地文件（笔记或常见附件类型）
    if (!LINKABLE_EXT_RE.test(raw)) continue
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      // 保留原样
    }
    // Obsidian 风格 / 开头表示 vault 根目录
    const resolved = decoded.startsWith('/')
      ? normalizePosix(decoded.slice(1))
      : normalizePosix(`${dirOf(sourcePath)}/${decoded}`)
    const key = `${kind}:${resolved.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ target: resolved, kind })
  }

  return out
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stemOf(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

interface LinkRow {
  source_path: string
  target_title: string
  target_path: string | null
  kind: string
}

/**
 * LinkGraph：解析全库双向链接，提供反向链接、未链接提及与图谱数据。
 * 链接目标按「文件名 > front-matter 标题 > 路径」优先解析（大小写不敏感）。
 */
export class LinkGraph {
  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: Vault,
    private readonly index: NoteIndex
  ) {}

  /** 清空链接索引（切换 Vault 时用） */
  clearAll(): void {
    this.db.exec('DELETE FROM links')
  }

  /** 目标 → 路径的解析表（小写键）：笔记按 文件名/标题/路径，附件按 路径/文件名 */
  private async targetMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const note of this.index.list()) {
      const stem = stemOf(note.path)
      map.set(stem.toLowerCase(), note.path)
      map.set(note.title.toLowerCase(), note.path)
      map.set(note.path.toLowerCase(), note.path)
      map.set(note.path.replace(/\.md$/i, '').toLowerCase(), note.path)
    }
    // 附件（图片/PDF/Office 等）同样可作为链接目标
    try {
      for (const file of await this.vault.listAllFiles()) {
        if (/\.md$/i.test(file)) continue
        map.set(file.toLowerCase(), file)
        const base = (file.split('/').pop() ?? file).toLowerCase()
        if (!map.has(base)) map.set(base, file)
      }
    } catch {
      // 列举失败时仅按笔记解析
    }
    return map
  }

  /** 重建单篇笔记的链接记录 */
  async indexNote(path: string, content: string): Promise<void> {
    const map = await this.targetMap()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM links WHERE source_path = ?').run(path)
      const insert = this.db.prepare(
        'INSERT OR REPLACE INTO links (source_path, target_title, target_path, kind) VALUES (?, ?, ?, ?)'
      )
      for (const link of extractLinks(content, path)) {
        const resolved = map.get(link.target.toLowerCase()) ?? null
        insert.run(path, link.target, resolved, link.kind)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  removeNote(path: string): void {
    this.db.prepare('DELETE FROM links WHERE source_path = ?').run(path)
    // 其他笔记指向它的链接变为未解析
    this.db
      .prepare('UPDATE links SET target_path = NULL WHERE target_path = ?')
      .run(path)
  }

  /** 反向链接：哪些笔记链接到了当前笔记 */
  backlinks(path: string): BacklinkInfo[] {
    const rows = this.db
      .prepare('SELECT DISTINCT source_path FROM links WHERE target_path = ? AND source_path <> ?')
      .all(path, path) as Array<{ source_path: string }>
    if (rows.length === 0) return []
    const notes = new Map(this.index.list().map((n) => [n.path, n.title]))
    return rows
      .map((row) => ({ path: row.source_path, title: notes.get(row.source_path) ?? stemOf(row.source_path) }))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }

  /** 未链接提及：正文提到标题但未建立链接的笔记 */
  async unlinkedMentions(path: string): Promise<UnlinkedMention[]> {
    const target = this.index.list().find((n) => n.path === path)
    if (!target) return []
    const keys = [...new Set([target.title, stemOf(path)])].filter((k) => k.length >= 2)
    if (keys.length === 0) return []

    const linked = new Set(
      (
        this.db
          .prepare('SELECT DISTINCT source_path FROM links WHERE target_path = ?')
          .all(path) as Array<{ source_path: string }>
      ).map((row) => row.source_path)
    )

    const candidates = new Map<string, string>()
    for (const key of keys) {
      for (const hit of this.index.search(key, 30)) {
        if (hit.path !== path && !linked.has(hit.path)) candidates.set(hit.path, key)
      }
    }

    const results: UnlinkedMention[] = []
    const notes = new Map(this.index.list().map((n) => [n.path, n.title]))
    for (const [candidatePath, key] of candidates) {
      try {
        const raw = await this.vault.read(candidatePath)
        const lower = raw.toLowerCase()
        const index = lower.indexOf(key.toLowerCase())
        if (index === -1) continue
        const start = Math.max(0, index - 40)
        const end = Math.min(raw.length, index + key.length + 60)
        const snippet =
          (start > 0 ? '… ' : '') +
          escapeHtml(raw.slice(start, index)) +
          '<mark>' +
          escapeHtml(raw.slice(index, index + key.length)) +
          '</mark>' +
          escapeHtml(raw.slice(index + key.length, end)) +
          ' …'
        results.push({
          path: candidatePath,
          title: notes.get(candidatePath) ?? stemOf(candidatePath),
          snippet
        })
      } catch {
        // 读取失败跳过
      }
    }
    return results.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }

  /** 图谱数据：笔记 + 被引用的附件为节点，已解析的链接为边 */
  graph(): GraphData {
    const notes = this.index.list()
    const nodeMap = new Map<string, GraphNode>()
    for (const note of notes) {
      nodeMap.set(note.path, { id: note.path, title: note.title, tags: note.tags, kind: 'note' })
    }

    const rows = this.db
      .prepare('SELECT source_path, target_path FROM links WHERE target_path IS NOT NULL')
      .all() as Array<{ source_path: string; target_path: string }>

    // 被引用的非笔记文件也作为节点（按引用数聚合）
    for (const row of rows) {
      if (nodeMap.has(row.target_path) || /\.md$/i.test(row.target_path)) continue
      nodeMap.set(row.target_path, {
        id: row.target_path,
        title: row.target_path.split('/').pop() ?? row.target_path,
        tags: [],
        kind: 'file'
      })
    }

    const edges: GraphEdge[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (row.source_path === row.target_path) continue
      if (!nodeMap.has(row.source_path) || !nodeMap.has(row.target_path)) continue
      const key = `${row.source_path}->${row.target_path}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: row.source_path, target: row.target_path })
    }
    return { nodes: [...nodeMap.values()], edges }
  }
}
