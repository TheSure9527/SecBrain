import { describe, expect, it } from 'vitest'
import { splitBlocks } from '../src/renderer/src/markdown/blocks'

describe('splitBlocks', () => {
  it('按空行切块并保留源码偏移', () => {
    const content = '# 标题\n\n第一段\n第二行\n\n- 列表一\n- 列表二\n'
    const blocks = splitBlocks(content)
    expect(blocks.map((b) => b.raw.trim())).toEqual([
      '# 标题',
      '第一段\n第二行',
      '- 列表一\n- 列表二'
    ])
    // 偏移可精确还原
    for (const block of blocks) {
      expect(content.slice(block.start, block.end)).toBe(block.raw)
    }
  })

  it('代码块内部的空行不切分', () => {
    const content = '```ts\nconst a = 1\n\nconst b = 2\n```\n\n正文'
    const blocks = splitBlocks(content)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.raw).toContain('const b = 2')
  })

  it('front-matter 单独成块', () => {
    const content = '---\ntitle: 测试\n---\n\n正文'
    const blocks = splitBlocks(content)
    expect(blocks[0]!.raw.startsWith('---')).toBe(true)
    expect(blocks[1]!.raw.trim()).toBe('正文')
  })

  it('空内容返回空数组', () => {
    expect(splitBlocks('')).toEqual([])
    expect(splitBlocks('\n\n')).toEqual([])
  })
})
