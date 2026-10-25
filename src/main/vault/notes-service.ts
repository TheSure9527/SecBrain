import { relative, sep } from 'node:path'
import type {
  CreateNoteInput,
  NoteDoc,
  NoteMeta,
  NoteSearchHit,
  SaveAttachmentInput,
  SaveAttachmentResult,
  UpdateNoteInput,
  VaultChange
} from '../../shared/ipc'
import { Vault, type TrashEntry, type VaultFileEvent } from './vault'
import type { TreeNode } from './vault'
import { parseNote, serializeNote } from './note-file'
import { extractProps, parsePropInput } from './props'
import { IndexCoordinator, LinkGraphProvider, NoteSearchProvider } from '../indexing'
import type { DocSnapshot } from '../indexing'
import type { NoteIndex } from './note-index'
import type { LinkGraph } from './link-graph'

function stemOf(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

const WELCOME_NOTE = `---
title: "欢迎使用 SecBrain"
tags: [指南]
---

# 欢迎使用 SecBrain

这是你的私人知识库 + 管家，当前是 **M2 知识库阶段**。

## 已经能用

- 新建 / 编辑 / 删除 Markdown 笔记
- 全文搜索（支持中文）
- 标签（front-matter 或行内 #标签）
- 粘贴图片自动存入附件目录

## 数据说明

- 所有笔记都是标准 Markdown 文件，可以直接用 Obsidian 打开同一个目录
- 搜索索引由应用自动维护，删了会重建

## 即将到来

- 日历同步（iCloud CalDAV）
- 任务管理
- AI 管家（自然语言管理日程）

祝你记下每一个值得记住的念头。
`

/**
 * NotesService：编排 Vault（文件）与 NoteIndex（索引）。
 * 对外提供全部笔记业务能力；文件变化（含外部工具改动）自动同步索引。
 */
export class NotesService {
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>()
  private watcher: { close: () => Promise<void> } | null = null

  /** 内部变更监听（给语义索引做增量更新） */
  private changeListener: ((change: VaultChange) => void) | null = null

  private coordinator: IndexCoordinator

  constructor(
    private vault: Vault,
    private readonly index: NoteIndex,
    private readonly emit: (change: VaultChange) => void,
    private readonly links: LinkGraph
  ) {
    // 默认协调器：全文+属性、链接图；注册处可替换为包含语义索引的完整协调器
    this.coordinator = new IndexCoordinator([
      new NoteSearchProvider(this.index),
      new LinkGraphProvider(this.links)
    ])
  }

  /** 由装配层注入完整协调器（含语义索引 provider） */
  setIndexCoordinator(coordinator: IndexCoordinator): void {
    this.coordinator = coordinator
  }

  setChangeListener(listener: (change: VaultChange) => void): void {
    this.changeListener = listener
  }

  /** 当前 Vault 根目录 */
  get vaultRoot(): string {
    return this.vault.root
  }

  /** vault 相对路径 → 绝对路径（用于外部打开等） */
  absPath(relPath: string): string {
    return this.vault.abs(relPath)
  }

  async init(): Promise<void> {
    await this.vault.ensure()
    await this.vault.purgeOldTrash()
    const files = await this.vault.listMarkdown()
    if (files.length === 0) {
      await this.vault.write('欢迎使用-SecBrain.md', WELCOME_NOTE)
      files.push('欢迎使用-SecBrain.md')
    }
    for (const path of files) {
      await this.reindex(path)
    }
    this.watcher = this.vault.watch((event) => {
      void this.handleFileEvent(event)
    })
  }

  // ---------- 文件树操作 ----------

  listTree(): Promise<TreeNode[]> {
    return this.vault.listTree()
  }

  /** 在指定目录新建笔记并返回文档 */
  async createFileInDir(dir: string, title?: string): Promise<NoteDoc> {
    const path = await this.vault.createFile(dir, title)
    return (await this.readNote(path))!
  }

  async createDir(dir: string, name: string): Promise<string> {
    const path = await this.vault.createDir(dir, name)
    this.notify({ type: 'tree' })
    return path
  }

  /** 重命名文件/文件夹；笔记自动迁移索引，并更新全库 [[引用]] */
  async renameEntry(path: string, newName: string): Promise<string> {
    const isMd = path.toLowerCase().endsWith('.md')
    const oldStem = isMd ? path.split('/').pop()!.replace(/\.md$/i, '') : ''
    const newPath = await this.vault.renamePath(path, newName)
    if (isMd) {
      await this.invalidateIndex(path)
      await this.reindex(newPath)
      const newStem = newPath.split('/').pop()!.replace(/\.md$/i, '')
      if (oldStem && newStem !== oldStem) {
        await this.updateReferences(oldStem, newStem)
      }
      this.notify({ type: 'upsert', path: newPath })
    }
    this.notify({ type: 'tree' })
    return newPath
  }

  /** 全库改写指向旧名称的 [[链接]] / ![[嵌入]] */
  private async updateReferences(oldStem: string, newStem: string): Promise<void> {
    const escaped = oldStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(!?)\\[\\[${escaped}(?=[|#\\]])`, 'g')
    for (const filePath of await this.vault.listMarkdown()) {
      try {
        const raw = await this.vault.read(filePath)
        if (!raw.includes(oldStem)) continue
        const next = raw.replace(pattern, `$1[[${newStem}`)
        if (next === raw) continue
        await this.vault.write(filePath, next)
        await this.reindex(filePath)
        this.notify({ type: 'upsert', path: filePath })
      } catch {
        // 单篇失败不影响其它文件
      }
    }
  }

  /** 移动文件/文件夹到目标目录 */
  async moveEntry(path: string, targetDir: string): Promise<string> {
    const isMd = path.toLowerCase().endsWith('.md')
    const newPath = await this.vault.movePath(path, targetDir)
    if (isMd) {
      await this.invalidateIndex(path)
      await this.reindex(newPath)
      this.notify({ type: 'upsert', path: newPath })
    }
    this.notify({ type: 'tree' })
    return newPath
  }

  /** 删除到回收站 */
  async deleteEntry(path: string): Promise<void> {
    await this.vault.deleteToTrash(path)
    if (path.toLowerCase().endsWith('.md')) {
      await this.invalidateIndex(path)
      this.notify({ type: 'delete', path })
    }
    this.notify({ type: 'tree' })
  }

  /** 统一出口：通知渲染层 + 内部监听者（语义索引增量） */
  private notify(change: VaultChange): void {
    this.emit(change)
    this.changeListener?.(change)
  }

  /** 外部写入文件后刷新索引并通知渲染层 */
  async refreshNote(path: string): Promise<void> {
    await this.reindex(path)
    this.notify({ type: 'upsert', path })
  }

  listTrash(): Promise<TrashEntry[]> {
    return this.vault.listTrash()
  }

  async restoreFromTrash(name: string): Promise<string> {
    const path = await this.vault.restoreFromTrash(name)
    if (path.toLowerCase().endsWith('.md')) await this.reindex(path)
    this.notify({ type: 'tree' })
    return path
  }

  // ---------- 链接系统 ----------

  backlinks(path: string) {
    return this.links.backlinks(path)
  }

  unlinkedMentions(path: string) {
    return this.links.unlinkedMentions(path)
  }

  graph() {
    return this.links.graph()
  }

  async emptyTrash(): Promise<number> {
    const count = await this.vault.emptyTrash()
    this.notify({ type: 'tree' })
    return count
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    this.debounceTimers.clear()
    void this.watcher?.close()
    this.watcher = null
  }

  /** 切换 Vault：停监听、清索引、重建（调用方负责持久化路径） */
  async switchVault(root: string): Promise<void> {
    this.dispose()
    this.index.clearAll()
    this.links.clearAll()
    this.vault = new Vault(root)
    await this.init()
    this.notify({ type: 'tree' })
  }

  listNotes(): NoteMeta[] {
    return this.index.list()
  }

  searchNotes(query: string, limit = 30): NoteSearchHit[] {
    return this.index.search(query, limit)
  }

  async readNote(path: string): Promise<NoteDoc | null> {
    // 只有 Markdown 才是笔记；docx/pdf 等由 DocumentIndexer 提供正文
    if (!/\.md$/i.test(path)) return null
    if (!(await this.vault.exists(path))) return null
    const raw = await this.vault.read(path)
    const parsed = parseNote(raw, stemOf(path))
    const updatedAt = await this.vault.mtime(path)
    const props: Record<string, string> = {}
    for (const prop of extractProps(parsed.data)) {
      props[prop.key] = prop.value
    }
    return {
      path,
      title: parsed.title,
      tags: parsed.tags,
      createdAt: parsed.createdAt,
      updatedAt,
      content: parsed.content,
      props
    }
  }

  /** 更新自定义 front-matter 属性（保留正文、标题、标签与创建时间） */
  async updateProps(path: string, props: Record<string, string>): Promise<NoteDoc> {
    const raw = await this.vault.read(path)
    const parsed = parseNote(raw, stemOf(path))
    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      if (key === 'title' || key === 'tags' || key === 'created') continue
      const key2 = key.trim()
      if (!key2) continue
      extra[key2] = parsePropInput(value)
    }
    const next = serializeNote({
      title: parsed.title,
      tags: parsed.tags,
      createdAt: parsed.createdAt,
      content: parsed.content,
      extra
    })
    await this.vault.write(path, next)
    await this.reindex(path)
    this.notify({ type: 'upsert', path })
    return (await this.readNote(path))!
  }

  async createNote(input: CreateNoteInput): Promise<NoteDoc> {
    const title = input.title?.trim() || '未命名笔记'
    const createdAt = new Date().toISOString()
    const path = this.vault.uniquePath(title)
    const raw = serializeNote({ title, createdAt, content: input.content ?? '' })
    await this.vault.write(path, raw)
    // 立即建索引（不依赖文件监听，避免新建后搜索/语义索引拿不到）
    await this.reindex(path)
    this.notify({ type: 'upsert', path })
    return (await this.readNote(path))!
  }

  async updateNote(input: UpdateNoteInput): Promise<NoteDoc> {
    const existing = await this.readNote(input.path)
    if (!existing) throw new Error(`笔记不存在: ${input.path}`)
    const title = input.title?.trim() || existing.title
    // 保留自定义 front-matter 属性（Dataview 查询依赖）
    const parsed = parseNote(await this.vault.read(input.path), stemOf(input.path))
    const extra: Record<string, unknown> = {}
    for (const key of Object.keys(parsed.data)) {
      if (key === 'title' || key === 'tags' || key === 'created') continue
      extra[key] = parsed.data[key]
    }
    const raw = serializeNote({
      title,
      tags: existing.tags,
      createdAt: existing.createdAt,
      content: input.content,
      extra
    })
    await this.vault.write(input.path, raw)
    return (await this.readNote(input.path))!
  }

  async deleteNote(path: string): Promise<void> {
    await this.vault.remove(path)
    await this.invalidateIndex(path)
    this.notify({ type: 'delete', path })
  }

  async saveAttachment(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
    const match = /^data:([\w/+.-]+);base64,(.*)$/s.exec(input.dataUrl)
    if (!match) throw new Error('附件数据格式不正确')
    const mime = match[1]!
    const data = Buffer.from(match[2]!, 'base64')

    const mimeExt: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf'
    }
    const filename = input.filename || `pasted${mimeExt[mime] ?? '.png'}`
    const attachmentPath = await this.vault.saveAttachment(input.notePath, filename, data)

    // 计算相对笔记的链接路径
    const noteDir = input.notePath.split('/').slice(0, -1).join('/')
    const relLink = noteDir ? relative(noteDir, attachmentPath).split(sep).join('/') : attachmentPath
    const markdown = `![${filename.replace(/\.[^.]+$/, '')}](${relLink})`
    return { attachmentPath, markdown }
  }

  private async reindex(relPath: string): Promise<NoteMeta> {
    const raw = await this.vault.read(relPath)
    const parsed = parseNote(raw, stemOf(relPath))
    const updatedAt = await this.vault.mtime(relPath)
    const meta: NoteMeta = {
      path: relPath,
      title: parsed.title,
      tags: parsed.tags,
      createdAt: parsed.createdAt,
      updatedAt
    }
    await this.applyIndexChange({
      docId: relPath,
      sourceId: relPath,
      text: parsed.content,
      meta: {
        title: parsed.title,
        tags: parsed.tags,
        createdAt: parsed.createdAt,
        props: extractProps(parsed.data)
      },
      updatedAt: Date.now()
    })
    return meta
  }

  /** 索引变更统一入口（失败只记录，不阻断保存） */
  private async applyIndexChange(snapshot: DocSnapshot): Promise<void> {
    try {
      await this.coordinator.onChanged(snapshot)
    } catch (err) {
      console.warn('[index] 笔记索引更新不完整:', err instanceof Error ? err.message : err)
    }
  }

  private async invalidateIndex(path: string): Promise<void> {
    try {
      await this.coordinator.onDeleted(path)
    } catch (err) {
      console.warn('[index] 笔记索引清理不完整:', err instanceof Error ? err.message : err)
    }
  }

  private async handleFileEvent(event: VaultFileEvent): Promise<void> {
    // 目录变化或非 md 文件：只通知刷新文件树
    if (event.type === 'addDir' || event.type === 'unlinkDir') {
      this.notify({ type: 'tree' })
      return
    }
    if (event.type === 'unlink') {
      await this.invalidateIndex(event.path)
      this.notify({ type: 'delete', path: event.path })
      if (!event.path.toLowerCase().endsWith('.md')) this.notify({ type: 'tree' })
      return
    }
    if (!event.path.toLowerCase().endsWith('.md')) {
      this.notify({ type: 'tree' })
      return
    }
    // 防抖：编辑器保存会产生 add + change 连击
    const existing = this.debounceTimers.get(event.path)
    if (existing) clearTimeout(existing)
    this.debounceTimers.set(
      event.path,
      setTimeout(() => {
        this.debounceTimers.delete(event.path)
        void this.vault
          .exists(event.path)
          .then((ok) => {
            if (!ok) return
            return this.reindex(event.path)
          })
          .then(() => this.notify({ type: 'upsert', path: event.path }))
          .catch(() => {
            /* 文件读取失败时静默，下次事件会重试 */
          })
      }, 150)
    )
  }
}
