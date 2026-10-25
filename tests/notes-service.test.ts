import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { Vault } from '../src/main/vault/vault'
import { NoteIndex } from '../src/main/vault/note-index'
import { NotesService } from '../src/main/vault/notes-service'
import { LinkGraph } from '../src/main/vault/link-graph'
import { applySchema } from '../src/main/db/schema'
import type { VaultChange } from '../src/shared/ipc'

// node:sqlite 不在 Node builtinModules 列表中，vite 无法静态解析，
// 测试环境经 createRequire 加载（生产构建中走正常外部化）
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let root: string
let service: NotesService
let changes: VaultChange[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'secbrain-test-'))
  changes = []
  const vault = new Vault(root)
  const db = new DatabaseSync(':memory:')
  applySchema(db)
  const index = new NoteIndex(db)
  const links = new LinkGraph(db, vault, index)
  service = new NotesService(vault, index, (change) => changes.push(change), links)
  await service.init()
})

afterEach(async () => {
  service.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('NotesService.init', () => {
  it('空 vault 会创建欢迎笔记并建索引', () => {
    expect(existsSync(join(root, '欢迎使用-SecBrain.md'))).toBe(true)
    const notes = service.listNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0]!.title).toBe('欢迎使用 SecBrain')
    expect(notes[0]!.tags).toContain('指南')
  })

  it('已有笔记的 vault 直接索引，不重复创建欢迎笔记', async () => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'secbrain-existing-'))
    try {
      await writeFile(join(otherRoot, '旧笔记.md'), '---\ntitle: "旧笔记"\n---\n\n之前写的内容')
      const vault = new Vault(otherRoot)
      const db = new DatabaseSync(':memory:')
      applySchema(db)
      const otherIndex = new NoteIndex(db)
      const other = new NotesService(vault, otherIndex, () => {}, new LinkGraph(db, vault, otherIndex))
      await other.init()
      const notes = other.listNotes()
      expect(notes.map((n) => n.path)).toEqual(['旧笔记.md'])
      expect(existsSync(join(otherRoot, '欢迎使用-SecBrain.md'))).toBe(false)
      other.dispose()
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
  })
})

describe('NotesService 笔记 CRUD', () => {
  it('create 落盘且可读回', async () => {
    const doc = await service.createNote({ title: '测试笔记', content: '你好世界' })
    expect(doc.title).toBe('测试笔记')
    expect(doc.content).toBe('你好世界')
    expect(existsSync(join(root, '测试笔记.md'))).toBe(true)

    const raw = await readFile(join(root, '测试笔记.md'), 'utf8')
    expect(raw).toContain('title: "测试笔记"')
    expect(raw).toContain('你好世界')

    const reread = await service.readNote('测试笔记.md')
    expect(reread?.title).toBe('测试笔记')
    expect(reread?.content).toBe('你好世界')
  })

  it('同名标题创建得到不冲突路径', async () => {
    const a = await service.createNote({ title: '重复' })
    const b = await service.createNote({ title: '重复' })
    expect(a.path).toBe('重复.md')
    expect(b.path).toBe('重复-1.md')
  })

  it('update 保持 front-matter 的 created 不变', async () => {
    const doc = await service.createNote({ title: '可改', content: 'v1' })
    const updated = await service.updateNote({ path: doc.path, content: 'v2' })
    expect(updated.content).toBe('v2')
    expect(updated.createdAt).toBe(doc.createdAt)
  })

  it('update 可修改标题', async () => {
    const doc = await service.createNote({ title: '旧标题' })
    const updated = await service.updateNote({ path: doc.path, content: '', title: '新标题' })
    expect(updated.title).toBe('新标题')
  })

  it('update 不存在的笔记抛错', async () => {
    await expect(service.updateNote({ path: 'nope.md', content: 'x' })).rejects.toThrow()
  })

  it('delete 删除文件与索引', async () => {
    const doc = await service.createNote({ title: '待删除' })
    await service.deleteNote(doc.path)
    expect(existsSync(join(root, doc.path))).toBe(false)
    expect(service.listNotes().some((n) => n.path === doc.path)).toBe(false)
  })

  it('readNote 对不存在的路径返回 null', async () => {
    expect(await service.readNote('ghost.md')).toBeNull()
  })

  it('readNote 对非 Markdown 文件返回 null（避免把二进制当笔记解析）', async () => {
    await writeFile(join(root, '简历.docx'), 'PK\u0003\u0004binary-docx')
    expect(await service.readNote('简历.docx')).toBeNull()
  })

  it('updateProps 写入属性且保留标题/正文/创建时间', async () => {
    const doc = await service.createNote({ title: '带属性', content: '正文内容' })
    const updated = await service.updateProps(doc.path, {
      status: '未完成',
      rating: '5',
      archived: 'false',
      tags2: '[工作, 重要]'
    })
    expect(updated.props).toMatchObject({
      status: '未完成',
      rating: '5',
      archived: 'false',
      tags2: '["工作","重要"]'
    })
    expect(updated.title).toBe('带属性')
    expect(updated.content).toBe('正文内容')
    expect(updated.createdAt).toBe(doc.createdAt)
  })

  it('update 编辑正文时保留自定义属性', async () => {
    const doc = await service.createNote({ title: '保留属性', content: 'v1' })
    await service.updateProps(doc.path, { status: '进行中' })
    const updated = await service.updateNote({ path: doc.path, content: 'v2' })
    expect(updated.content).toBe('v2')
    expect(updated.props.status).toBe('进行中')
  })
})

describe('NotesService 索引协调器接入', () => {
  it('创建/删除笔记会经过统一索引入口', async () => {
    const { IndexCoordinator } = await import('../src/main/indexing')
    const upsert = vi.fn(async () => {})
    const invalidate = vi.fn(async () => {})
    service.setIndexCoordinator(
      new IndexCoordinator([
        { name: 'spy', upsert, invalidate }
      ])
    )

    const doc = await service.createNote({ title: '索引入口', content: '内容' })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ docId: doc.path }))

    await service.deleteNote(doc.path)
    expect(invalidate).toHaveBeenCalledWith(doc.path)
  })
})

describe('NotesService 外部变更同步（模拟 Obsidian）', () => {
  it('外部新建文件 → 索引更新并推送 upsert 事件', async () => {
    await writeFile(join(root, '外部笔记.md'), '---\ntitle: "外部笔记"\n---\n\n外部写入的独特内容zzz')
    await vi.waitFor(
      () => {
        expect(service.listNotes().some((n) => n.path === '外部笔记.md')).toBe(true)
      },
      { timeout: 10_000, interval: 100 }
    )
    expect(changes.some((c) => c.type === 'upsert' && c.path === '外部笔记.md')).toBe(true)
    expect(service.searchNotes('独特内容zzz').length).toBeGreaterThan(0)
  })

  it('外部删除文件 → 索引移除并推送 delete 事件', async () => {
    await writeFile(join(root, '临时.md'), '---\ntitle: "临时"\n---\n\n内容')
    await vi.waitFor(
      () => expect(service.listNotes().some((n) => n.path === '临时.md')).toBe(true),
      { timeout: 10_000, interval: 100 }
    )
    changes.length = 0
    await rm(join(root, '临时.md'))
    await vi.waitFor(
      () => {
        expect(service.listNotes().some((n) => n.path === '临时.md')).toBe(false)
      },
      { timeout: 3000 }
    )
    expect(changes.some((c) => c.type === 'delete' && c.path === '临时.md')).toBe(true)
  })

  it('子目录中的笔记同样被索引', async () => {
    await mkdir(join(root, '日记'), { recursive: true })
    await writeFile(join(root, '日记', '今天.md'), '---\ntitle: "今天"\n---\n\n日记内容')
    await vi.waitFor(
      () => expect(service.listNotes().some((n) => n.path === '日记/今天.md')).toBe(true),
      { timeout: 3000 }
    )
  })
})

describe('NotesService 切换 Vault', () => {
  it('切换后索引重建：旧库笔记消失、新库笔记可见', async () => {
    const otherRoot = await mkdtemp(join(tmpdir(), 'secbrain-vault2-'))
    try {
      await writeFile(join(otherRoot, '另一个库.md'), '---\ntitle: "另一个库"\n---\n\n另一个库的内容')
      await service.switchVault(otherRoot)

      const notes = service.listNotes()
      expect(notes.map((n) => n.path)).toEqual(['另一个库.md'])
      expect(notes[0]!.title).toBe('另一个库')
      // 旧库的欢迎笔记已不在索引中
      expect(service.listNotes().some((n) => n.path === '欢迎使用-SecBrain.md')).toBe(false)
      // 事件推送：切换后发出 tree 变更
      expect(changes.some((c) => c.type === 'tree')).toBe(true)

      // 新库中可正常创建
      const created = await service.createNote({ title: '新库笔记' })
      expect(existsSync(join(otherRoot, created.path))).toBe(true)

      // 切回原库：欢迎笔记重新出现
      await service.switchVault(root)
      const back = service.listNotes()
      expect(back.some((n) => n.path === '欢迎使用-SecBrain.md')).toBe(true)
      expect(back.some((n) => n.path === '另一个库.md')).toBe(false)
    } finally {
      await rm(otherRoot, { recursive: true, force: true })
    }
  })

  it('空目录的新库自动播种欢迎笔记', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'secbrain-vault3-'))
    try {
      await service.switchVault(emptyRoot)
      expect(existsSync(join(emptyRoot, '欢迎使用-SecBrain.md'))).toBe(true)
      expect(service.listNotes()).toHaveLength(1)
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }
  })
})

describe('NotesService 附件', () => {
  it('保存 PNG 附件到 attachments/<笔记名>/ 并返回相对 Markdown', async () => {
    const doc = await service.createNote({ title: '带图笔记' })
    // 1x1 透明 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
    const result = await service.saveAttachment({
      notePath: doc.path,
      filename: 'screenshot.png',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`
    })
    expect(result.attachmentPath).toMatch(/^attachments\/带图笔记\/screenshot\.png$/)
    expect(result.markdown).toBe('![screenshot](attachments/带图笔记/screenshot.png)')
    expect(existsSync(join(root, result.attachmentPath))).toBe(true)
  })

  it('子目录笔记的附件链接使用正确的相对路径', async () => {
    await writeFile(join(root, '子目录.md'), '---\ntitle: "子目录"\n---\n\n内容')
    await vi.waitFor(
      () => expect(service.listNotes().some((n) => n.path === '子目录.md')).toBe(true),
      { timeout: 3000 }
    )
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
    const result = await service.saveAttachment({
      notePath: '子目录.md',
      filename: 'a.png',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`
    })
    expect(result.markdown).toBe('![a](attachments/子目录/a.png)')
  })

  it('不支持的附件类型抛错', async () => {
    const doc = await service.createNote({ title: '笔记x' })
    await expect(
      service.saveAttachment({ notePath: doc.path, filename: 'evil.exe', dataUrl: 'data:application/octet-stream;base64,AAAA' })
    ).rejects.toThrow()
  })
})
