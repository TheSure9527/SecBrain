import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SemanticHit, SemanticStatus } from '../../shared/semantic'
import type { NotesService } from '../vault'
import type { NoteIndex } from '../vault'
import type { SettingsService } from '../settings'
import type { DocumentIndexer } from '../indexer'
import { BuiltinEmbeddingProvider, bufferToVector, cosineSimilarity, vectorToBuffer, type EmbeddingProvider } from './embedding'
import { chunkMarkdown, excerpt } from './chunker'

interface CachedChunk {
  index: number
  text: string
  vector: Float32Array
}

const BATCH_SIZE = 8
/** 余弦阈值：低于它的候选不参与融合（否则拒答题会被强行召回） */
const MIN_SCORE = 0.5
const DEFAULT_MODEL = 'Xenova/bge-base-zh-v1.5'

export type ProviderFactory = (
  model: string,
  cacheDir: string,
  mirror: string,
  onProgress?: (percent: number) => void
) => EmbeddingProvider

/**
 * 语义索引服务：把笔记切块并用本地嵌入模型向量化，
 * 支持全量重建、单篇增量更新与向量检索。
 */
export class SemanticService {
  private cache = new Map<string, CachedChunk[]>()
  private provider: EmbeddingProvider | null = null
  private providerModel = ''
  private updating = false
  private downloadPercent: number | null = null
  private rebuildPromise: Promise<SemanticStatus> | null = null
  private updatingTimer: NodeJS.Timeout | null = null
  private pendingPaths = new Set<string>()
  private lastIndexedAt: string | null = null
  private lastError: string | null = null
  private modelReady = false

  constructor(
    private readonly db: DatabaseSync,
    private readonly notes: NotesService,
    private readonly index: NoteIndex,
    private readonly settings: SettingsService,
    private readonly modelsDir: string,
    private readonly providerFactory: ProviderFactory = (model, cacheDir, mirror, onProgress) =>
      new BuiltinEmbeddingProvider(model, cacheDir, mirror, onProgress),
    /** 非 Markdown 文档索引（可选，提供后一并向量化） */
    private readonly documents?: DocumentIndexer | null
  ) {
    this.lastIndexedAt = this.getMeta('semantic.lastIndexedAt')
    this.setEnabledFlag(this.settings.get().semanticEnabled)
  }

  // ---------- 配置 ----------

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  }

  private setEnabledFlag(enabled: boolean): void {
    this.enabled = enabled
  }

  private enabled = false

  private get model(): string {
    return this.settings.get().semanticModel || DEFAULT_MODEL
  }

  status(): SemanticStatus {
    let chunks = 0
    try {
      const row = this.db
        .prepare('SELECT COUNT(*) AS c FROM note_chunks WHERE model = ?')
        .get(this.model) as { c: number } | undefined
      chunks = row?.c ?? 0
    } catch {
      chunks = 0
    }
    return {
      enabled: this.enabled,
      model: this.model,
      modelReady: this.modelReady,
      downloadPercent: this.modelReady ? null : this.downloadPercent,
      indexedNotes: new Set([...this.cache.keys()]).size,
      indexedChunks: chunks,
      updating: this.updating,
      lastIndexedAt: this.lastIndexedAt,
      error: this.lastError
    }
  }

  /** 切换模型：保存设置并清空旧向量（下次重建会重新下载/编码） */
  setModel(model: string): SemanticStatus {
    this.settings.save({ ...this.settings.get(), semanticModel: model })
    this.provider = null
    this.providerModel = ''
    this.modelReady = false
    this.downloadPercent = null
    this.cache.clear()
    this.db.prepare('DELETE FROM note_chunks').run()
    return this.status()
  }

  async setEnabled(enabled: boolean): Promise<SemanticStatus> {
    this.enabled = enabled
    this.settings.save({ ...this.settings.get(), semanticEnabled: enabled })
    if (enabled) {
      await this.ensureIndex()
    } else {
      this.cache.clear()
    }
    return this.status()
  }

  /** 启动时调用：已开启则加载索引，索引为空则后台重建 */
  async ensureIndex(): Promise<void> {
    if (!this.enabled) return
    if (this.cache.size > 0) return
    const loaded = this.loadFromDb()
    if (loaded === 0) {
      void this.rebuild()
    }
  }

  private loadFromDb(): number {
    this.cache.clear()
    const rows = this.db
      .prepare('SELECT path, chunk_index, text, vector FROM note_chunks WHERE model = ?')
      .all(this.model) as Array<{
      path: string
      chunk_index: number
      text: string
      vector: Uint8Array
    }>
    for (const row of rows) {
      const list = this.cache.get(row.path) ?? []
      list.push({ index: row.chunk_index, text: row.text, vector: bufferToVector(row.vector) })
      this.cache.set(row.path, list)
    }
    return rows.length
  }

  private providerInstance(): EmbeddingProvider {
    const model = this.model
    if (!this.provider || this.providerModel !== model) {
      const mirror = this.settings.get().semanticMirror
      this.provider = this.providerFactory(model, this.modelsDir, mirror, (percent) => {
        this.downloadPercent = percent >= 100 ? null : percent
      })
      this.providerModel = model
      this.modelReady = false
      this.downloadPercent = 0
    }
    return this.provider
  }

  // ---------- 索引 ----------

  /** 全量重建语义索引（并发调用复用同一次重建） */
  rebuild(): Promise<SemanticStatus> {
    if (this.rebuildPromise) return this.rebuildPromise
    this.rebuildPromise = this.doRebuild().finally(() => {
      this.rebuildPromise = null
    })
    return this.rebuildPromise
  }

  private async doRebuild(): Promise<SemanticStatus> {
    this.updating = true
    this.lastError = null
    try {
      const notes = this.index.list()
      this.cache.clear()
      this.db.prepare('DELETE FROM note_chunks').run()


      for (const note of notes) {
        const doc = await this.notes.readNote(note.path)
        if (!doc) continue
        await this.storeChunks(note.path, doc.content)
      }

      // 非 Markdown 材料（docx/pdf/xlsx/文本）一并向量化
      for (const document of this.documents?.list() ?? []) {
        await this.storeChunks(document.path, document.text)
      }

      this.modelReady = true
      this.lastIndexedAt = new Date().toISOString()
      this.setMeta('semantic.lastIndexedAt', this.lastIndexedAt)
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.modelReady = false
    } finally {
      this.updating = false
    }
    return this.status()
  }

  /** 切块 + 向量化 + 入库（笔记与材料共用） */
  private async storeChunks(path: string, text: string): Promise<void> {
    const chunks = chunkMarkdown(text)
    if (chunks.length === 0) return
    const stored: CachedChunk[] = []
    for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + BATCH_SIZE)
      const vectors = await this.providerInstance().embed(batch.map((c) => c.text))
      const insert = this.db.prepare(
        'INSERT OR REPLACE INTO note_chunks (path, chunk_index, text, vector, dim, model) VALUES (?, ?, ?, ?, ?, ?)'
      )
      batch.forEach((chunk, i) => {
        const vector = vectors[i]!
        insert.run(path, chunk.index, chunk.text, vectorToBuffer(vector), vector.length, this.model)
        stored.push({ index: chunk.index, text: chunk.text, vector })
      })
    }
    this.cache.set(path, stored)
    this.rememberHash(path, this.hashOf(text))
  }

  /** 材料（docx/pdf/xlsx/文本）变更后的增量向量化 */
  async indexDocument(path: string): Promise<void> {
    if (!this.enabled) return
    // 排队串行处理，避免材料批量变更时并发编码
    this.enqueue(async () => {
      try {
        const material = this.documents?.getText(path)
        if (!material?.text) return
        const hash = this.hashOf(material.text)
        if (
          this.storedHash(path) === hash &&
          this.db.prepare('SELECT 1 FROM note_chunks WHERE path = ? LIMIT 1').get(path)
        ) {
          return
        }
        this.db.prepare('DELETE FROM note_chunks WHERE path = ?').run(path)
        this.cache.delete(path)
        await this.storeChunks(path, material.text)
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
      }
    })
  }

  /** 删除某篇文档的向量（由索引协调器调用） */
  removeNote(path: string): void {
    this.db.prepare('DELETE FROM note_chunks WHERE path = ?').run(path)
    this.cache.delete(path)
  }

  /** 笔记变更时延迟增量更新（由 NotesService 变更回调触发） */
  /** 串行队列：避免启动时上百个文档同时编码把内存打爆 */
  private queue: Promise<void> = Promise.resolve()

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((err) => {
      this.lastError = err instanceof Error ? err.message : String(err)
    })
  }

  private hashOf(text: string): string {
    return createHash('sha1').update(text).digest('hex').slice(0, 16)
  }

  private storedHash(path: string): string | null {
    const row = this.db.prepare('SELECT hash FROM semantic_docs WHERE path = ?').get(path) as
      | { hash: string }
      | undefined
    return row?.hash ?? null
  }

  private rememberHash(path: string, hash: string): void {
    this.db
      .prepare(
        'INSERT INTO semantic_docs (path, hash, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at'
      )
      .run(path, hash, new Date().toISOString())
  }

  onNoteChanged(path: string): void {
    if (!this.enabled) return
    this.pendingPaths.add(path)
    if (this.updatingTimer) clearTimeout(this.updatingTimer)
    this.updatingTimer = setTimeout(() => {
      const paths = [...this.pendingPaths]
      this.pendingPaths.clear()
      // 一次只处理一个文档，避免 169 篇笔记同时调用 ONNX 导致 OOM
      this.enqueue(async () => {
        for (const p of paths) {
          await this.updateNote(p)
          await new Promise((resolve) => setImmediate(resolve))
        }
      })
    }, 2000)
  }

  private async updateNote(path: string): Promise<void> {
    try {
      const doc = await this.notes.readNote(path)
      if (!doc) return
      const hash = this.hashOf(doc.content)
      // 内容没变就不重复编码（否则每次启动都要重算全库）
      if (this.storedHash(path) === hash && this.db.prepare('SELECT 1 FROM note_chunks WHERE path = ? LIMIT 1').get(path)) {
        return
      }
      this.db.prepare('DELETE FROM note_chunks WHERE path = ?').run(path)
      this.cache.delete(path)
      await this.storeChunks(path, doc.content)
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  // ---------- 检索 ----------

  async search(query: string, limit = 8): Promise<SemanticHit[]> {
    if (!this.enabled || !query.trim() || this.cache.size === 0) return []
    const [queryVector] = await this.providerInstance().embed([query])
    if (!queryVector) return []

    const best = new Map<string, { score: number; text: string }>()
    for (const [path, chunks] of this.cache) {
      for (const chunk of chunks) {
        const score = cosineSimilarity(queryVector, chunk.vector)
        const current = best.get(path)
        if (!current || score > current.score) best.set(path, { score, text: chunk.text })
      }
    }

    const titles = new Map<string, string>([
      ...this.index.list().map((n): [string, string] => [n.path, n.title]),
      ...(this.documents?.titles() ?? []).map((d): [string, string] => [d.path, d.title])
    ])
    return [...best.entries()]
      .filter(([, info]) => info.score >= MIN_SCORE)
      .map(([path, info]) => ({
        path,
        title: titles.get(path) ?? path.split('/').pop() ?? path,
        snippet: excerpt(info.text),
        score: info.score
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /** 关闭服务（测试/退出用） */
  dispose(): void {
    if (this.updatingTimer) clearTimeout(this.updatingTimer)
    this.updatingTimer = null
    this.cache.clear()
  }
}
