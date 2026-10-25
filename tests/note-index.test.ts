import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { NoteIndex } from '../src/main/vault/note-index'
import { applySchema } from '../src/main/db/schema'

// node:sqlite 不在 Node builtinModules 列表中，vite 无法静态解析，
// 测试环境经 createRequire 加载（生产构建中走正常外部化）
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: DatabaseSync
let index: NoteIndex

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  index = new NoteIndex(db)
})

afterEach(() => db.close())

function upsert(path: string, title: string, content: string, updatedAt = '2026-10-23T10:00:00.000Z') {
  index.upsert({
    path,
    title,
    tags: [],
    content,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt
  })
}

describe('NoteIndex', () => {
  it('upsert 后 list 能取回元信息', () => {
    upsert('a.md', '标题A', '内容A')
    const list = index.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ path: 'a.md', title: '标题A' })
  })

  it('重复 upsert 同一路径不会产生重复行', () => {
    upsert('a.md', '标题A', '内容A')
    upsert('a.md', '标题A改', '内容A改')
    const list = index.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('标题A改')
  })

  it('list 按更新时间倒序', () => {
    upsert('old.md', '旧', 'x', '2026-01-01T00:00:00.000Z')
    upsert('new.md', '新', 'x', '2026-12-01T00:00:00.000Z')
    expect(index.list().map((n) => n.path)).toEqual(['new.md', 'old.md'])
  })

  it('remove 后搜索与列表均不可见', () => {
    upsert('a.md', '标题A', '独特内容abc')
    index.remove('a.md')
    expect(index.list()).toHaveLength(0)
    expect(index.search('独特内容abc')).toHaveLength(0)
  })

  describe('搜索', () => {
    beforeEach(() => {
      upsert('meeting.md', '周会纪要', '讨论了产品路线图 和 发布计划')
      upsert('idea.md', '灵感', '想做一个私人管家应用')
    })

    it('中文 >=3 字符子串可命中', () => {
      const hits = index.search('路线图')
      expect(hits.map((h) => h.path)).toEqual(['meeting.md'])
    })

    it('英文子串可命中', () => {
      upsert('en.md', 'English note', 'private butler application')
      const hits = index.search('butler appl')
      expect(hits.map((h) => h.path)).toContain('en.md')
    })

    it('2 字符短查询走 LIKE 兜底仍可命中', () => {
      const hits = index.search('灵感')
      expect(hits.map((h) => h.path)).toEqual(['idea.md'])
    })

    it('无匹配时返回空', () => {
      expect(index.search('完全不存在的词xyz')).toHaveLength(0)
    })

    it('空查询返回空', () => {
      expect(index.search('   ')).toHaveLength(0)
    })

    it('snippet 含 <mark> 高亮', () => {
      const hits = index.search('私人管家')
      expect(hits[0]!.snippet).toContain('<mark>私人管家</mark>')
    })

    it('snippet 中的 HTML 被转义（防注入）', () => {
      upsert('xss.md', 'xss', '内容 <script>alert(1)</script> 结束')
      const hits = index.search('<script>alert(1)')
      const all = hits.flatMap((h) => h.snippet.split('<mark>').flatMap((s) => s.split('</mark>')))
      expect(all.join('')).not.toContain('<script>alert')
      expect(hits[0]!.snippet).toContain('&lt;script&gt;')
    })

    it('查询串中的双引号不会破坏 MATCH 语法', () => {
      upsert('quote.md', '引号', '他说"你好"然后离开')
      const hits = index.search('"你好"')
      expect(hits.map((h) => h.path)).toContain('quote.md')
    })
  })
})
