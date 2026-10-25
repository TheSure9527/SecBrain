import { describe, expect, it } from 'vitest'
import { extractProps, parsePropInput } from '../../src/main/vault/props'

describe('extractProps', () => {
  it('提取字符串/数字/布尔/日期/数组', () => {
    const date = new Date('2026-10-01T00:00:00.000Z')
    const props = extractProps({
      status: '未完成',
      rating: 4,
      archived: false,
      due: date,
      authors: ['张三', '李四']
    })
    expect(props).toEqual([
      { key: 'status', value: '未完成', type: 'string' },
      { key: 'rating', value: '4', type: 'number' },
      { key: 'archived', value: 'false', type: 'boolean' },
      { key: 'due', value: '2026-10-01T00:00:00.000Z', type: 'date' },
      { key: 'authors', value: '["张三","李四"]', type: 'array' }
    ])
  })

  it('跳过 title / tags 与空值', () => {
    const props = extractProps({ title: '标题', tags: ['a'], empty: null, missing: undefined })
    expect(props).toEqual([])
  })

  it('嵌套对象转 JSON 字符串', () => {
    const props = extractProps({ meta: { a: 1 } })
    expect(props).toEqual([{ key: 'meta', value: '{"a":1}', type: 'string' }])
  })
})

describe('parsePropInput', () => {
  it('数字/布尔/字符串', () => {
    expect(parsePropInput('42')).toBe(42)
    expect(parsePropInput('-3.5')).toBe(-3.5)
    expect(parsePropInput('true')).toBe(true)
    expect(parsePropInput('false')).toBe(false)
    expect(parsePropInput('未完成')).toBe('未完成')
  })

  it('数组：JSON 与逗号两种写法', () => {
    expect(parsePropInput('["a","b"]')).toEqual(['a', 'b'])
    expect(parsePropInput('[工作, 重要]')).toEqual(['工作', '重要'])
  })

  it('空值返回空字符串', () => {
    expect(parsePropInput('   ')).toBe('')
  })
})
