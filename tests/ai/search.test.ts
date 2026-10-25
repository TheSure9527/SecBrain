import { describe, expect, it } from 'vitest'
import { rrfMerge, stripHighlight } from '../../src/main/ai/search'

const hit = (path: string, title = path, snippet = ''): { path: string; title: string; snippet: string } => ({
  path,
  title,
  snippet
})

describe('rrfMerge', () => {
  it('两路结果融合并按名次加权', () => {
    const keyword = [hit('a.md'), hit('b.md'), hit('c.md')]
    const semantic = [hit('c.md'), hit('d.md')]
    const merged = rrfMerge([keyword, semantic], 10)
    // c 出现在两路中，得分最高
    expect(merged[0]!.path).toBe('c.md')
    expect(merged.map((m) => m.path)).toEqual(
      expect.arrayContaining(['a.md', 'b.md', 'c.md', 'd.md'])
    )
    // 得分降序
    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i - 1]!.score).toBeGreaterThanOrEqual(merged[i]!.score)
    }
  })

  it('去重同一路径并保留首个非空摘录', () => {
    const merged = rrfMerge([[hit('a.md', 'A', '')], [hit('a.md', 'A', '摘录')]], 5)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.snippet).toBe('摘录')
  })

  it('限制返回条数', () => {
    const list = Array.from({ length: 20 }, (_, i) => hit(`n${i}.md`))
    expect(rrfMerge([list], 5)).toHaveLength(5)
  })

  it('空输入返回空', () => {
    expect(rrfMerge([], 5)).toEqual([])
    expect(rrfMerge([[], []], 5)).toEqual([])
  })
})

describe('stripHighlight', () => {
  it('去掉 mark 标签并反转义', () => {
    expect(stripHighlight('<mark>关键</mark>&lt;x&gt;')).toBe('关键<x>')
  })
})
