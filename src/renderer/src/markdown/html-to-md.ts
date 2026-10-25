/**
 * 把预览栏编辑后的 HTML 还原成 Markdown。
 *
 * 只覆盖我们渲染管线会产出的标签（标题 / 段落 / 强调 / 链接 / 图片 / 列表 / 引用 / 代码），
 * 保证"所见即所得编辑"回写后仍是干净 Markdown，而不是一堆 <span>。
 */

const INLINE_TAGS = new Set(['SPAN', 'MARK', 'U', 'SMALL', 'FONT'])

function escapeInline(text: string): string {
  return text.replace(/\*\*/g, '**').replace(/(^|\n)(#{1,6})\s/g, '$1\\$2 ')
}

function serializeChildren(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    out += serializeNode(child)
  })
  return out
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u00a0/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName

  // 数学公式 / Mermaid 图表：这些块不允许可视化编辑，直接保留原始文本（调用方会拦截）
  if (el.classList.contains('katex') || el.classList.contains('mermaid')) {
    return el.textContent ?? ''
  }

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    return `${'#'.repeat(level)} ${serializeChildren(el).trim()}\n\n`
  }
  if (tag === 'P' || tag === 'DIV') {
    const inner = serializeChildren(el).trim()
    return inner ? `${inner}\n\n` : ''
  }
  if (tag === 'BR') return '\n'
  if (tag === 'HR') return '---\n\n'
  if (tag === 'STRONG' || tag === 'B') return `**${serializeChildren(el)}**`
  if (tag === 'EM' || tag === 'I') return `*${serializeChildren(el)}*`
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') return `~~${serializeChildren(el)}~~`
  if (tag === 'MARK') return `==${serializeChildren(el)}==`
  if (tag === 'CODE') {
    // 代码块内的 <code> 由 PRE 统一处理
    if (el.parentElement?.tagName === 'PRE') return serializeChildren(el)
    return `\`${serializeChildren(el)}\``
  }
  if (tag === 'PRE') {
    const code = el.querySelector('code')
    const language = (' ' + (code?.className ?? '')).match(/(?:language|lang)-([\w-]+)/)?.[1] ?? ''
    const body = (code ?? el).textContent ?? ''
    return `\`\`\`${language}\n${body.replace(/\n$/, '')}\n\`\`\`\n\n`
  }
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? ''
    const text = serializeChildren(el)
    const wiki = el.getAttribute('data-wikilink')
    if (wiki) return `[[${wiki}]]`
    return href ? `[${text}](${href})` : text
  }
  if (tag === 'IMG') {
    const alt = el.getAttribute('alt') ?? ''
    const src = el.getAttribute('src') ?? ''
    return `![${alt}](${src})`
  }
  if (tag === 'BLOCKQUOTE') {
    const inner = serializeChildren(el).trim()
    return `${inner
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n')}\n\n`
  }
  if (tag === 'UL' || tag === 'OL') {
    const ordered = tag === 'OL'
    let index = 0
    const items: string[] = []
    el.querySelectorAll(':scope > li').forEach((li) => {
      index += 1
      const inner = serializeChildren(li).trim().replace(/\n{2,}/g, '\n')
      const marker = ordered ? `${index}. ` : '- '
      const lines = inner.split('\n')
      items.push(
        `${marker}${lines[0] ?? ''}` +
          (lines.length > 1 ? `\n${lines.slice(1).map((line) => `  ${line}`).join('\n')}` : '')
      )
    })
    return `${items.join('\n')}\n\n`
  }
  if (tag === 'TABLE') {
    const rows = [...el.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((cell) => (cell.textContent ?? '').trim())
    )
    if (rows.length === 0) return ''
    const width = Math.max(...rows.map((row) => row.length))
    const pad = (row: string[]): string =>
      `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`
    const header = pad(rows[0]!)
    const divider = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
    const body = rows.slice(1).map(pad).join('\n')
    return `${[header, divider, body].filter(Boolean).join('\n')}\n\n`
  }
  if (INLINE_TAGS.has(tag)) return serializeChildren(el)

  return serializeChildren(el)
}

/** 把一段渲染后的 HTML 还原为 Markdown 文本 */
export function htmlToMarkdown(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  return serializeChildren(container)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** 该块是否适合可视化编辑（公式、图表、代码块保持源码编辑） */
export function canEditVisually(html: string): boolean {
  return !/class="[^"]*(katex|mermaid)/.test(html) && !html.includes('<pre')
}
