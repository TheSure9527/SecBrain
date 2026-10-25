import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySchema } from '../../src/main/db/schema'
import { Vault } from '../../src/main/vault/vault'
import { NoteIndex } from '../../src/main/vault/note-index'
import { LinkGraph, extractLinks } from '../../src/main/vault/link-graph'
import { NotesService } from '../../src/main/vault/notes-service'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let root: string
let vault: Vault
let index: NoteIndex
let links: LinkGraph

beforeEach(async () => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  root = await mkdtemp(join(tmpdir(), 'myzsk-links-'))
  vault = new Vault(root)
  await vault.ensure()
  index = new NoteIndex(db)
  links = new LinkGraph(db, vault, index)
})

afterEach(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})

/** 写入笔记文件并建立索引 */
async function addNote(path: string, title: string, content: string): Promise<void> {
  await vault.write(path, content)
  const meta = {
    path,
    title,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  index.upsert({ ...meta, content })
  await links.indexNote(path, content)
}

describe('extractLinks', () => {
  it('解析普通链接、别名、标题锚点与嵌入', () => {
    const content = '见 [[笔记A]]、[[笔记B|别名]]、[[笔记C#小节]] 和 ![[图片.png]]'
    const result = extractLinks(content)
    expect(result).toEqual([
      { target: '笔记A', kind: 'link' },
      { target: '笔记B', kind: 'link' },
      { target: '笔记C', kind: 'link' },
      { target: '图片.png', kind: 'embed' }
    ])
  })

  it('同一目标去重', () => {
    expect(extractLinks('[[A]] 和 [[A]] 以及 [[A|别名]]')).toHaveLength(1)
  })

  it('忽略代码块中的链接', () => {
    const content = '```\n[[不是链接]]\n```\n行内 `[[也不是]]` 但 [[是链接]]'
    const result = extractLinks(content)
    expect(result.map((l) => l.target)).toEqual(['是链接'])
  })

  it('空链接与纯锚点忽略', () => {
    expect(extractLinks('[[]] [[#小节]] [[|别名]]')).toHaveLength(0)
  })

  it('解析 Markdown 链接（相对当前笔记目录）', () => {
    const content = '见 [说明](templates/requirement.md) 与 [上级](../笔记/xxx.md#小节)'
    const result = extractLinks(content, 'commands/create.md')
    expect(result).toEqual([
      { target: 'commands/templates/requirement.md', kind: 'link' },
      { target: '笔记/xxx.md', kind: 'link' }
    ])
  })

  it('Markdown 链接支持根路径、URL 编码与尖括号', () => {
    const content = '[A](/notes/a.md) [B](<子 目录/b.md>) [C](c%20d.md)'
    const result = extractLinks(content, '根.md')
    expect(result.map((l) => l.target)).toEqual(['notes/a.md', '子 目录/b.md', 'c d.md'])
  })

  it('外链被忽略，本地附件链接计入', () => {
    const content = '[外链](https://a.com) [图片](a.png) [邮件](mailto:a@b.com)'
    expect(extractLinks(content, 'x.md')).toEqual([{ target: 'a.png', kind: 'link' }])
  })

  it('图片与笔记嵌入都被识别', () => {
    const content = '![图](a.png) ![嵌入](b.md)'
    const result = extractLinks(content, 'x.md')
    expect(result).toEqual([
      { target: 'a.png', kind: 'embed' },
      { target: 'b.md', kind: 'embed' }
    ])
  })
})

describe('LinkGraph 反向链接', () => {
  it('按文件名解析目标并生成反链', async () => {
    await addNote('A.md', '笔记A', '我是 A')
    await addNote('B.md', '笔记B', '链接到 [[A]]')
    await addNote('子目录/C.md', '笔记C', '也链接 [[A|别名]]')

    const backlinks = links.backlinks('A.md')
    expect(backlinks.map((b) => b.path).sort()).toEqual(['B.md', '子目录/C.md'])
  })

  it('按 front-matter 标题解析', async () => {
    await addNote('A.md', '项目计划', '内容')
    await addNote('B.md', '笔记B', '参见 [[项目计划]]')
    expect(links.backlinks('A.md')).toHaveLength(1)
  })

  it('自链接不计入反链', async () => {
    await addNote('A.md', '笔记A', '自引用 [[A]]')
    expect(links.backlinks('A.md')).toHaveLength(0)
  })

  it('Markdown 链接同样生成反链（真实场景）', async () => {
    await addNote('指南.md', '指南', '内容')
    await addNote(
      'commands/create.md',
      '创建命令',
      '先阅读 [指南](../指南.md) 再操作'
    )
    const backlinks = links.backlinks('指南.md')
    expect(backlinks.map((b) => b.path)).toEqual(['commands/create.md'])
  })

  it('未解析的目标不产生反链', async () => {
    await addNote('A.md', '笔记A', '内容')
    await addNote('B.md', '笔记B', '指向不存在 [[幽灵笔记]]')
    expect(links.backlinks('A.md')).toHaveLength(0)
  })
})

describe('LinkGraph 未链接提及', () => {
  it('正文提到标题但未加链接时被检出', async () => {
    await addNote('A.md', '读书笔记', '关于读书笔记的记录')
    await addNote('B.md', 'B', '今天又想到读书笔记这件事，值得整理')

    const mentions = await links.unlinkedMentions('A.md')
    expect(mentions.map((m) => m.path)).toEqual(['B.md'])
    expect(mentions[0]!.snippet).toContain('<mark>')
  })

  it('已建立链接的不再算未链接提及', async () => {
    await addNote('A.md', '读书笔记', '内容')
    await addNote('B.md', 'B', '参见 [[读书笔记]]')
    expect(await links.unlinkedMentions('A.md')).toHaveLength(0)
  })

  it('自身不算提及', async () => {
    await addNote('A.md', '读书笔记', '读书笔记的自我描述')
    expect(await links.unlinkedMentions('A.md')).toHaveLength(0)
  })
})

describe('LinkGraph 图谱数据', () => {
  it('节点为全部笔记、边为已解析链接', async () => {
    await addNote('A.md', '笔记A', '内容')
    await addNote('B.md', '笔记B', '[[A]]')
    await addNote('C.md', '笔记C', '[[不存在]]')

    const graph = links.graph()
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md'])
    expect(graph.edges).toEqual([{ source: 'B.md', target: 'A.md' }])
  })

  it('自链接不产生边', async () => {
    await addNote('A.md', '笔记A', '[[A]]')
    expect(links.graph().edges).toHaveLength(0)
  })
})

describe('LinkGraph 删除清理', () => {
  it('删除笔记后其发出的链接被清理，指向它的链接变为未解析', async () => {
    await addNote('A.md', '笔记A', '内容')
    await addNote('B.md', '笔记B', '[[A]] 与 [[B]]')

    links.removeNote('B.md')
    expect(links.graph().edges).toHaveLength(0)
    // A 仍存在
    expect(links.graph().nodes.map((n) => n.id)).toContain('A.md')

    links.removeNote('A.md')
    expect(links.backlinks('A.md')).toHaveLength(0)
  })
})

describe('LinkGraph 附件链接（非 md 文件）', () => {
  it('Markdown 链接到附件：解析为文件节点并生成反链', async () => {
    await mkdir(join(root, 'attachments'), { recursive: true })
    await writeFile(join(root, 'attachments', 'report.pdf'), 'pdf')
    await addNote('笔记.md', '笔记', '见 [报告](attachments/report.pdf)')

    const graph = links.graph()
    const fileNode = graph.nodes.find((n) => n.id === 'attachments/report.pdf')
    expect(fileNode?.kind).toBe('file')
    expect(graph.edges).toEqual([{ source: '笔记.md', target: 'attachments/report.pdf' }])
    expect(links.backlinks('attachments/report.pdf').map((b) => b.path)).toEqual(['笔记.md'])
  })

  it('双链引用附件按文件名解析', async () => {
    await mkdir(join(root, 'images'), { recursive: true })
    await writeFile(join(root, 'images', 'photo.png'), 'png')
    await addNote('笔记.md', '笔记', '![[photo.png]]')

    expect(links.backlinks('images/photo.png').map((b) => b.path)).toEqual(['笔记.md'])
  })

  it('不存在的附件保持未解析', async () => {
    await addNote('笔记.md', '笔记', '[缺失](attachments/missing.pdf)')
    expect(links.graph().edges).toHaveLength(0)
  })
})

describe('NotesService 重命名联动', () => {
  it('重命名笔记后全库 [[引用]] 自动更新', async () => {
    const changes: unknown[] = []
    const service = new NotesService(vault, index, (c) => changes.push(c), links)
    await service.init()

    await addNote('被引用.md', '被引用', '目标笔记')
    await addNote('引用方.md', '引用方', '参见 [[被引用]] 与 ![[被引用]]')
    await addNote('无关.md', '无关', '[[别的东西]]')

    await service.renameEntry('被引用.md', '新名字')

    const referrer = await vault.read('引用方.md')
    expect(referrer).toContain('[[新名字]]')
    expect(referrer).toContain('![[新名字]]')
    expect(referrer).not.toContain('[[被引用]]')
    expect(await vault.read('无关.md')).toBe('[[别的东西]]')

    // 链接索引已指向新路径
    expect(links.backlinks('新名字.md').map((b) => b.path)).toContain('引用方.md')
    service.dispose()
  })

  it('重命名同名前缀不会误伤（如 A 与 AB）', async () => {
    const service = new NotesService(vault, index, () => {}, links)
    await service.init()
    await addNote('A.md', 'A', '内容')
    await addNote('AB.md', 'AB', '内容')
    await addNote('引用.md', '引用', '[[A]] 与 [[AB]]')

    await service.renameEntry('A.md', 'X')

    const content = await vault.read('引用.md')
    expect(content).toContain('[[X]]')
    expect(content).toContain('[[AB]]')
    service.dispose()
  })
})
