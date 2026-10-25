import { describe, expect, it } from 'vitest'
import { extractInlineTags, parseNote, serializeNote, slugify } from '../src/main/vault/note-file'

describe('parseNote', () => {
  it('解析 front-matter 的 title / tags / created', () => {
    const parsed = parseNote('---\ntitle: "会议纪要"\ntags: [工作, 会议]\ncreated: 2026-01-01T00:00:00.000Z\n---\n\n正文内容')
    expect(parsed.title).toBe('会议纪要')
    expect(parsed.tags).toEqual(['工作', '会议'])
    expect(parsed.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(parsed.content).toBe('正文内容')
  })

  it('无 front-matter 时取第一个标题作为标题', () => {
    const parsed = parseNote('# 我的想法\n\n一些内容')
    expect(parsed.title).toBe('我的想法')
    expect(parsed.content).toBe('# 我的想法\n\n一些内容')
  })

  it('无标题信息时兜底为「未命名」', () => {
    expect(parseNote('just text').title).toBe('未命名')
  })

  it('合并 front-matter 标签与行内标签', () => {
    const parsed = parseNote('---\ntitle: t\ntags: [a]\n---\n\n#b 和 #c 标签')
    expect(parsed.tags.sort()).toEqual(['a', 'b', 'c'])
  })

  it('front-matter 损坏时退化为纯正文解析', () => {
    const parsed = parseNote('---\ntitle: [unclosed\n---\n\n正文')
    expect(parsed.content).toContain('正文')
    expect(parsed.tags).toEqual([])
  })
})

describe('serializeNote / parseNote 往返', () => {
  it('序列化后可被完整解析', () => {
    const raw = serializeNote({
      title: '带: 特殊 # 字符',
      tags: ['x', 'y'],
      createdAt: '2026-02-02T02:02:02.000Z',
      content: '# 标题\n\n内容 #tag'
    })
    const parsed = parseNote(raw)
    expect(parsed.title).toBe('带: 特殊 # 字符')
    expect(parsed.createdAt).toBe('2026-02-02T02:02:02.000Z')
    expect(parsed.content).toBe('# 标题\n\n内容 #tag')
    expect(parsed.tags).toContain('tag')
  })
})

describe('extractInlineTags', () => {
  it('只匹配行首或空白后的 #', () => {
    expect(extractInlineTags('#a #b\n\n正文 #c 结尾 #d.')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('不匹配单词中间的 #', () => {
    expect(extractInlineTags('C# 语言')).toEqual([])
  })
})

describe('slugify', () => {
  it('保留中文，剔除非法字符', () => {
    expect(slugify('会议纪要 2026/10/23')).toBe('会议纪要-20261023')
  })

  it('剔除路径分隔符等危险字符', () => {
    expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })

  it('空结果兜底为 untitled', () => {
    expect(slugify('///')).toBe('untitled')
    expect(slugify('   ')).toBe('untitled')
  })
})
