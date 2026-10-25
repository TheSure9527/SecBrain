import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// SettingsService 依赖 electron 的 nativeTheme
vi.mock('electron', () => ({
  nativeTheme: { themeSource: 'system' },
  safeStorage: {
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

import { applySchema } from '../../src/main/db/schema'
import { Vault } from '../../src/main/vault/vault'
import { NoteIndex } from '../../src/main/vault/note-index'
import { LinkGraph } from '../../src/main/vault/link-graph'
import { NotesService } from '../../src/main/vault/notes-service'
import { SettingsService } from '../../src/main/settings/settings-service'
import { SemanticService, type ProviderFactory } from '../../src/main/semantic/semantic-service'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

/** 用关键词计数模拟嵌入，便于断言排序 */
const fakeProvider: ProviderFactory = () => ({
  model: 'fake',
  embed: async (texts: string[]) =>
    texts.map((text) => {
      const vec = new Float32Array([(text.match(/苹果/g) ?? []).length, (text.match(/香蕉/g) ?? []).length, 0.2])
      const norm = Math.hypot(vec[0]!, vec[1]!, vec[2]!) || 1
      return new Float32Array([vec[0]! / norm, vec[1]! / norm, vec[2]! / norm])
    })
})

let db: ReturnType<typeof DatabaseSync>
let root: string
let notes: NotesService
let settings: SettingsService
let semantic: SemanticService

beforeEach(async () => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  root = await mkdtemp(join(tmpdir(), 'secbrain-semantic-'))
  const vault = new Vault(root)
  await vault.ensure()
  const index = new NoteIndex(db)
  notes = new NotesService(vault, index, () => {}, new LinkGraph(db, vault, index))
  await notes.init()
  settings = new SettingsService(db)
  semantic = new SemanticService(db, notes, index, settings, root, fakeProvider)
})

afterEach(async () => {
  semantic.dispose()
  notes.dispose()
  db.close()
  await rm(root, { recursive: true, force: true })
})

describe('SemanticService', () => {
  it('未启用时检索返回空', async () => {
    expect(await semantic.search('苹果')).toEqual([])
    expect(semantic.status().enabled).toBe(false)
  })

  it('启用后重建索引，语义检索能命中相关笔记', async () => {
    await notes.createNote({ title: '水果笔记', content: '苹果 苹果 很好吃' })
    await notes.createNote({ title: '另一个笔记', content: '香蕉 也不错' })

    await semantic.setEnabled(true)
    await semantic.rebuild()

    const status = semantic.status()
    expect(status.enabled).toBe(true)
    expect(status.indexedChunks).toBeGreaterThan(0)
    expect(status.lastIndexedAt).not.toBeNull()

    const hits = await semantic.search('苹果', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.title).toBe('水果笔记')
    expect(hits[0]!.score).toBeGreaterThan(0)
    expect(hits[0]!.snippet).toBeTruthy()
  })

  it('停用后清空缓存且不再检索', async () => {
    await notes.createNote({ title: '水果笔记', content: '苹果' })
    await semantic.setEnabled(true)
    await semantic.rebuild()
    expect((await semantic.search('苹果')).length).toBeGreaterThan(0)

    await semantic.setEnabled(false)
    expect(await semantic.search('苹果')).toEqual([])
  })

  it('重建会清空旧索引（内容更新后结果随之变化）', async () => {
    const doc = await notes.createNote({ title: '可变笔记', content: '香蕉' })
    await semantic.setEnabled(true)
    await semantic.rebuild()

    await notes.updateNote({ path: doc.path, content: '苹果 苹果' })
    await semantic.rebuild()

    const hits = await semantic.search('苹果', 5)
    expect(hits[0]!.path).toBe(doc.path)
  })
})
