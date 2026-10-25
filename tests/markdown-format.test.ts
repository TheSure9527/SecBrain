import { describe, expect, it } from 'vitest'
import {
  applyInlineToBlock,
  numberLines,
  prefixLines,
  wrapText
} from '../src/renderer/src/markdown/format'

describe('wrapText', () => {
  it('加粗并可在同一位置取消', () => {
    expect(wrapText('重点', 'bold')).toBe('**重点**')
    expect(wrapText('**重点**', 'bold')).toBe('重点')
  })

  it('斜体与删除线', () => {
    expect(wrapText('强调', 'italic')).toBe('*强调*')
    expect(wrapText('废弃', 'strike')).toBe('~~废弃~~')
  })
})

describe('prefixLines', () => {
  it('给多行加引用前缀', () => {
    expect(prefixLines('第一行\n第二行', '> ')).toBe('> 第一行\n> 第二行')
  })

  it('已有前缀时移除', () => {
    expect(prefixLines('> 第一行', '> ')).toBe('第一行')
  })

  it('替换标题级别而不是叠加', () => {
    expect(prefixLines('## 标题', '# ')).toBe('# 标题')
  })
})

describe('numberLines', () => {
  it('生成有序编号并支持取消', () => {
    expect(numberLines('甲\n乙\n丙')).toBe('1. 甲\n2. 乙\n3. 丙')
    expect(numberLines('1. 甲\n2. 乙')).toBe('甲\n乙')
  })
})

describe('applyInlineToBlock', () => {
  it('在块内定位选中文字并加粗', () => {
    const raw = '### 今日小记\n昨天和喜欢的女生聊天'
    expect(applyInlineToBlock(raw, '喜欢的女生', 'bold')).toBe(
      '### 今日小记\n昨天和**喜欢的女生**聊天'
    )
  })

  it('找不到选中文字时返回 null（调用方降级为整块编辑）', () => {
    // 选中文字在源码里不存在（比如渲染后自动加粗的标题文字）
    expect(applyInlineToBlock('## 今日小记', '完全不存在的片段', 'bold')).toBeNull()
  })
})

describe('listContinuation（回车续写列表）', () => {
  it('无序列表继续同样的标记', async () => {
    const { listContinuation } = await import('../src/renderer/src/markdown/format')
    expect(listContinuation('- 第一项')).toEqual({ insert: '\n- ' })
  })

  it('有序列表序号自增', async () => {
    const { listContinuation } = await import('../src/renderer/src/markdown/format')
    expect(listContinuation('2. 第二项')).toEqual({ insert: '\n3. ' })
  })

  it('保留缩进（子列表）', async () => {
    const { listContinuation } = await import('../src/renderer/src/markdown/format')
    expect(listContinuation('  - 子项')).toEqual({ insert: '\n  - ' })
  })

  it('空列表项回车退出列表', async () => {
    const { listContinuation } = await import('../src/renderer/src/markdown/format')
    expect(listContinuation('- ')).toEqual({ insert: '', clearLine: true })
  })

  it('普通段落不拦截回车', async () => {
    const { listContinuation } = await import('../src/renderer/src/markdown/format')
    expect(listContinuation('普通文字')).toBeNull()
  })
})
