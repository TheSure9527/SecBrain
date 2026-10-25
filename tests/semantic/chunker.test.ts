import { describe, expect, it } from 'vitest'
import { chunkMarkdown, excerpt } from '../../src/main/semantic/chunker'

describe('chunkMarkdown', () => {
  it('按段落切块并保持顺序', () => {
    const content = '第一段内容。\n\n第二段内容。\n\n第三段内容。'
    const chunks = chunkMarkdown(content)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]!.text).toContain('第一段')
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i))
  })

  it('超长段落按句子切分', () => {
    const sentence = '这是一个用来测试分块的较长句子。'
    const content = sentence.repeat(80)
    const chunks = chunkMarkdown(content, 300)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.text.length <= 300 + 80)).toBe(true)
  })

  it('空内容返回空数组', () => {
    expect(chunkMarkdown('   \n\n  ')).toEqual([])
  })

  it('剥离 front-matter', () => {
    const content = '---\ntitle: "测试"\n---\n\n正文内容'
    const chunks = chunkMarkdown(content)
    expect(chunks[0]!.text).not.toContain('title:')
    expect(chunks[0]!.text).toContain('正文内容')
  })
})

describe('excerpt', () => {
  it('去除 Markdown 标记并截断', () => {
    const text = '## 标题\n\n- 列表项 **加粗** 和 [链接](http://a.com)\n\n正文'
    const out = excerpt(text, 20)
    expect(out).not.toContain('#')
    expect(out).not.toContain('**')
    expect(out).not.toContain('](')
    expect(out.length).toBeLessThanOrEqual(21)
  })
})
