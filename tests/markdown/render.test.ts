import { describe, expect, it } from 'vitest'
import {
  parseCalloutHeader,
  preprocessFootnotes,
  preprocessWikilinks,
  renderMarkdown
} from '../../src/renderer/src/markdown/render'

describe('preprocessWikilinks', () => {
  it('双链转可点击链接', () => {
    const html = preprocessWikilinks('见 [[笔记A|别名]]')
    expect(html).toContain('[别名](wikilink://')
  })

  it('图片嵌入转 Markdown 图片，其他嵌入保留', () => {
    expect(preprocessWikilinks('![[a.png]]')).toBe('![](a.png)')
    expect(preprocessWikilinks('![[笔记]]')).toBe('![[笔记]]')
  })
})

describe('preprocessFootnotes', () => {
  it('引用替换为上标并追加列表', () => {
    const { notes } = preprocessFootnotes('正文[^1]\n\n[^1]: 注释内容')
    const { body } = preprocessFootnotes('正文[^1]\n\n[^1]: 注释内容')
    expect(notes).toEqual([{ id: '1', text: '注释内容' }])
    expect(body).toContain('class="fn-ref"')
    expect(body).toContain('id="fn-1"')
    expect(body).toContain('注释内容')
  })

  it('支持缩进续行', () => {
    const { notes } = preprocessFootnotes('[^a]: 第一行\n  第二行')
    expect(notes[0]!.text).toBe('第一行\n第二行')
  })

  it('无脚注时原样返回', () => {
    const { body, notes } = preprocessFootnotes('普通内容')
    expect(body).toBe('普通内容')
    expect(notes).toHaveLength(0)
  })
})

describe('parseCalloutHeader', () => {
  it('解析类型与标题', () => {
    expect(parseCalloutHeader('[!warning] 小心')).toEqual({ type: 'warning', title: '小心' })
    expect(parseCalloutHeader('[!NOTE]')).toEqual({ type: 'note', title: '' })
  })

  it('未知类型与普通引用返回 null', () => {
    expect(parseCalloutHeader('[!unknown] x')).toBeNull()
    expect(parseCalloutHeader('普通引用')).toBeNull()
  })
})

describe('renderMarkdown: Callouts', () => {
  it('渲染为 callout 卡片', () => {
    const html = renderMarkdown('> [!note] 提示\n> 这是正文')
    expect(html).toContain('class="callout callout-note"')
    expect(html).toContain('class="callout-title">提示')
    expect(html).toContain('这是正文')
  })

  it('无标题时用类型名兜底', () => {
    const html = renderMarkdown('> [!tip]\n> 内容')
    expect(html).toContain('class="callout-title">tip')
  })

  it('普通引用保持 blockquote', () => {
    const html = renderMarkdown('> 只是引用')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('callout')
  })

  it('未知 callout 类型保持 blockquote', () => {
    const html = renderMarkdown('> [!nonsense] x\n> y')
    expect(html).toContain('<blockquote>')
  })
})

describe('renderMarkdown: 高亮 / 数学 / Mermaid', () => {
  it('高亮 ==text==', () => {
    expect(renderMarkdown('这是 ==重点== 内容')).toContain('<mark>重点</mark>')
  })

  it('行内公式生成占位', () => {
    const html = renderMarkdown('公式 $x^2 + y^2$ 结束')
    expect(html).toContain('class="math-inline"')
    expect(html).toContain('data-math="x^2 + y^2"')
  })

  it('金额不被误判为公式', () => {
    expect(renderMarkdown('价格是 $5 和 $6')).not.toContain('data-math')
  })

  it('块级公式生成占位', () => {
    const html = renderMarkdown('$$\nE = mc^2\n$$')
    expect(html).toContain('class="math-block"')
    expect(html).toContain('data-math="E = mc^2"')
  })

  it('mermaid 代码块生成图表占位', () => {
    const html = renderMarkdown('```mermaid\ngraph TD;\nA-->B;\n```')
    expect(html).toContain('class="mermaid-block"')
    expect(html).toContain('A--&gt;B')
  })

  it('普通代码块不受影响', () => {
    const html = renderMarkdown('```ts\nconst a = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).not.toContain('mermaid-block')
  })

  it('代码块内的 == 与 $ 不被解析', () => {
    const html = renderMarkdown('```\n$not math$ ==not mark==\n```')
    expect(html).not.toContain('data-math')
    expect(html).not.toContain('<mark>')
  })
})

describe('renderMarkdown: 双链与图片', () => {
  it('双链渲染为带 data-wikilink 的链接', () => {
    const html = renderMarkdown('参见 [[项目计划]]')
    expect(html).toContain('data-wikilink="项目计划"')
    expect(html).toContain('class="wikilink"')
  })

  it('图片嵌入渲染为 img', () => {
    const html = renderMarkdown('![[attachments/a.png]]')
    expect(html).toContain('<img src="attachments/a.png"')
  })
})
