import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySchema } from '../../src/main/db/schema'
import { Vault } from '../../src/main/vault/vault'
import { DocumentIndexer } from '../../src/main/indexer/document-index'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let root: string
let vault: Vault
let docs: DocumentIndexer

beforeEach(async () => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  root = await mkdtemp(join(tmpdir(), 'myzsk-docs-'))
  vault = new Vault(root)
  await vault.ensure()
  docs = new DocumentIndexer(db, vault)
})

afterEach(async () => {
  docs.dispose()
  db.close()
  await rm(root, { recursive: true, force: true })
})

describe('DocumentIndexer', () => {
  it('扫描并索引文本类材料，跳过 Markdown 与图片', async () => {
    await writeFile(join(root, '简历.txt'), '姓名：张三\n技能：产品设计、原型')
    await writeFile(join(root, '笔记.md'), '# 笔记\n内容')
    await writeFile(join(root, '图片.png'), 'png')

    const status = await docs.rebuild()
    expect(status.count).toBe(1)
    expect(status.lastIndexedAt).not.toBeNull()
  })

  it('全文检索命中并给出摘录', async () => {
    await writeFile(join(root, '简历.txt'), '工作经历：负责产品设计与用户研究，主导过三个项目。')
    await docs.rebuild()

    const hits = docs.search('用户研究')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.path).toBe('简历.txt')
    expect(hits[0]!.title).toBe('简历')
    expect(hits[0]!.snippet).toContain('用户研究')
  })

  it('短词（<3 字）走 LIKE 兜底', async () => {
    await writeFile(join(root, '材料.txt'), '这里包含技能关键词')
    await docs.rebuild()
    const hits = docs.search('技能')
    expect(hits).toHaveLength(1)
  })

  it('可读取文档全文（供管家阅读）', async () => {
    await writeFile(join(root, '合同.txt'), '甲方：某某公司\n乙方：张三')
    await docs.rebuild()
    const material = docs.getText('合同.txt')
    expect(material?.title).toBe('合同')
    expect(material?.text).toContain('甲方')
  })

  it('删除文件后索引清理', async () => {
    await writeFile(join(root, '临时.txt'), '内容')
    await docs.rebuild()
    expect(docs.status().count).toBe(1)

    await unlink(join(root, '临时.txt'))
    await docs.rebuild()
    expect(docs.status().count).toBe(0)
  })

  it('子目录文件同样索引', async () => {
    await mkdir(join(root, '资料'), { recursive: true })
    await writeFile(join(root, '资料', '说明.txt'), '子目录中的材料')
    await docs.rebuild()
    expect(docs.list().map((d) => d.path)).toContain('资料/说明.txt')
  })

  it('读不了的文件记录在 issues 里并给出原因', async () => {
    await writeFile(join(root, '演示.pages'), 'not a real pages file')
    await writeFile(join(root, '正常.txt'), '可以读取')
    const status = await docs.rebuild()
    expect(status.count).toBe(1)
    expect(status.issues).toHaveLength(1)
    expect(status.issues[0]!.path).toBe('演示.pages')
    expect(status.issues[0]!.reason).toContain('iWork')
  })

  it('按目录/文件名匹配（目录名不在正文里也能找到）', async () => {
    await mkdir(join(root, '履历', '简历'), { recursive: true })
    await writeFile(join(root, '履历', '简历', '我的简历.txt'), '姓名：张三')
    await docs.rebuild()

    const hits = docs.searchByPath('履历')
    expect(hits.map((h) => h.path)).toContain('履历/简历/我的简历.txt')
    expect(hits[0]!.snippet).toContain('位于')
  })
})
