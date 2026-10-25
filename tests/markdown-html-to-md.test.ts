// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { canEditVisually, htmlToMarkdown } from '../src/renderer/src/markdown/html-to-md'

describe('htmlToMarkdown（预览可视化编辑回写）', () => {
  it('标题与段落', () => {
    expect(htmlToMarkdown('<h3>今日小记</h3><p>第一段</p>')).toBe('### 今日小记\n\n第一段')
  })

  it('行内强调 / 删除线 / 高亮 / 代码', () => {
    expect(htmlToMarkdown('<p>a<strong>b</strong><em>c</em><s>d</s><code>e</code></p>')).toBe(
      'a**b***c*~~d~~`e`'
    )
  })

  it('链接与图片', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com">站点</a></p>')).toBe('[站点](https://x.com)')
    expect(htmlToMarkdown('<p><img src="myzsk-file://vault/a.png" alt="图"></p>')).toBe(
      '![图](myzsk-file://vault/a.png)'
    )
  })

  it('双链还原成 [[标题]]', () => {
    expect(htmlToMarkdown('<p><a data-wikilink="项目A" href="#">项目A</a></p>')).toBe('[[项目A]]')
  })

  it('无序列表与有序列表', () => {
    expect(htmlToMarkdown('<ul><li>甲</li><li>乙</li></ul>')).toBe('- 甲\n- 乙')
    expect(htmlToMarkdown('<ol><li>一</li><li>二</li></ol>')).toBe('1. 一\n2. 二')
  })

  it('引用块每行加 >', () => {
    expect(htmlToMarkdown('<blockquote><p>甲<br>乙</p></blockquote>')).toBe('> 甲\n> 乙')
  })

  it('代码块保留语言', () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const a = 1</code></pre>')
    expect(md).toBe('```ts\nconst a = 1\n```')
  })

  it('表格还原为 Markdown 表格', () => {
    const md = htmlToMarkdown(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    )
    expect(md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  it('连续空行压缩为最多一个空行', () => {
    expect(htmlToMarkdown('<p>甲</p><p></p><p></p><p>乙</p>')).toBe('甲\n\n乙')
  })
})

describe('canEditVisually', () => {
  it('公式与图表不进入可视化编辑', () => {
    expect(canEditVisually('<span class="katex">x</span>')).toBe(false)
    expect(canEditVisually('<div class="mermaid">graph</div>')).toBe(false)
    expect(canEditVisually('<pre><code>a</code></pre>')).toBe(false)
    expect(canEditVisually('<h2>普通标题</h2>')).toBe(true)
  })
})
