import { describe, expect, it } from 'vitest'
import { extractHeadings } from '../../src/renderer/src/markdown/outline'

describe('extractHeadings', () => {
  it('提取多级标题与行号', () => {
    const content = '# 一级\n\n正文\n\n## 二级\n\n### 三级'
    expect(extractHeadings(content)).toEqual([
      { level: 1, text: '一级', line: 1 },
      { level: 2, text: '二级', line: 5 },
      { level: 3, text: '三级', line: 7 }
    ])
  })

  it('跳过代码块内的 # 行', () => {
    const content = '# 标题\n```\n# 代码注释\n```\n## 真标题'
    const headings = extractHeadings(content)
    expect(headings.map((h) => h.text)).toEqual(['标题', '真标题'])
  })

  it('忽略无空格的井号与超过 6 级', () => {
    const content = '#无空格\n####### 七级\n## 正常'
    expect(extractHeadings(content).map((h) => h.text)).toEqual(['正常'])
  })

  it('无标题返回空数组', () => {
    expect(extractHeadings('纯文本内容')).toEqual([])
  })
})
