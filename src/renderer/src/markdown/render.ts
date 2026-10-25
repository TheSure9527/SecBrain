import { marked, type TokenizerAndRendererExtension, type Tokens } from 'marked'

/**
 * Markdown 渲染管线（纯字符串处理，可在 Node 测试）：
 * wikilink/嵌入预处理 → 脚注提取 → marked（Callouts / 高亮 / 数学 / Mermaid 占位）。
 * KaTeX 与 Mermaid 的实际渲染在浏览器侧水合（hydrate.ts）。
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

const CALLOUT_TYPES = new Set([
  'note',
  'tip',
  'warning',
  'danger',
  'info',
  'success',
  'quote',
  'abstract',
  'todo',
  'bug',
  'example',
  'question'
])

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/\n/g, '&#10;')
}

/** [[双链]] 与 ![[嵌入]]：图片嵌入转 Markdown 图片，其余转可点击链接 */
export function preprocessWikilinks(content: string): string {
  return content
    .replace(/!\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g, (match, target: string) => {
      const path = target.trim()
      return IMAGE_EXT_RE.test(path) ? `![](${path})` : match
    })
    // 负向断言：跳过 ![[...]]（非图片嵌入保持原文，不转成链接）
    .replace(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
      const text = (label ?? target).trim()
      return `[${text}](wikilink://${encodeURIComponent(target.trim())})`
    })
}

export interface Footnote {
  id: string
  text: string
}

/**
 * 提取脚注定义（`[^id]: 内容`，支持两空格缩进的续行），
 * 把正文引用替换为上标链接，并在文末追加脚注列表。
 */
export function preprocessFootnotes(content: string): { body: string; notes: Footnote[] } {
  const notes: Footnote[] = []
  const bodyLines: string[] = []
  let current: Footnote | null = null

  for (const line of content.split('\n')) {
    const def = /^\[\^([^\]]+)\]:\s?(.*)$/.exec(line)
    if (def) {
      if (current) notes.push(current)
      current = { id: def[1]!, text: def[2] ?? '' }
      continue
    }
    if (current && /^\s{2,}\S/.test(line)) {
      current.text += '\n' + line.trim()
      continue
    }
    if (current) {
      notes.push(current)
      current = null
    }
    bodyLines.push(line)
  }
  if (current) notes.push(current)

  let body = bodyLines
    .join('\n')
    .replace(
      /\[\^([^\]]+)\]/g,
      (_m, id: string) =>
        `<sup class="fn-ref" id="fnref-${escapeAttr(id)}"><a href="#fn-${escapeAttr(id)}">${escapeHtml(id)}</a></sup>`
    )

  if (notes.length > 0) {
    const items = notes
      .map(
        (note) =>
          `<div class="fn-item" id="fn-${escapeAttr(note.id)}"><span class="fn-id">${escapeHtml(
            note.id
          )}</span><span class="fn-text">${escapeHtml(note.text).replace(/\n/g, '<br>')}</span></div>`
      )
      .join('\n\n')
    body += `\n\n<div class="footnotes">${items}</div>`
  }

  return { body, notes }
}

// ---------------------------------------------------------------------------
// marked 扩展：高亮 / 数学 / Mermaid / Callouts
// ---------------------------------------------------------------------------

const highlightExtension: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start(src: string) {
    return src.indexOf('==')
  },
  tokenizer(src: string) {
    const match = /^==([^=\n]+?)==/.exec(src)
    if (match) {
      return { type: 'highlight', raw: match[0], text: match[1]! }
    }
    return undefined
  },
  renderer(token) {
    return `<mark>${escapeHtml((token as Tokens.Generic).text as string)}</mark>`
  }
}

const mathBlockExtension: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src: string) {
    return src.indexOf('$$')
  },
  tokenizer(src: string) {
    const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src)
    if (match) {
      return { type: 'mathBlock', raw: match[0], text: match[1]!.trim() }
    }
    return undefined
  },
  renderer(token) {
    return `<div class="math-block" data-math="${escapeAttr((token as Tokens.Generic).text as string)}"></div>`
  }
}

const mathInlineExtension: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start(src: string) {
    return src.indexOf('$')
  },
  tokenizer(src: string) {
    // 要求内容不以空白开头/结尾，避免把「$5 和 $6」这类金额误判为公式
    const match = /^\$([^\s$](?:[^$\n]*[^\s$])?)\$/.exec(src)
    if (match) {
      return { type: 'mathInline', raw: match[0], text: match[1]! }
    }
    return undefined
  },
  renderer(token) {
    return `<span class="math-inline" data-math="${escapeAttr((token as Tokens.Generic).text as string)}"></span>`
  }
}

/** callout 标题行解析：`[!type] 标题` */
export function parseCalloutHeader(line: string): { type: string; title: string } | null {
  const match = /^\[!([a-zA-Z]+)\][+-]?\s*(.*)$/.exec(line.trim())
  if (!match) return null
  const type = match[1]!.toLowerCase()
  if (!CALLOUT_TYPES.has(type)) return null
  return { type, title: (match[2] ?? '').trim() }
}

marked.use({
  extensions: [highlightExtension, mathBlockExtension, mathInlineExtension],
  renderer: {
    code(token: Tokens.Code): string | false {
      const lang = token.lang?.trim()
      if (lang === 'mermaid') {
        return `<div class="mermaid-block" data-mermaid="${escapeAttr(token.text)}"></div>`
      }
      if (lang === 'query') {
        return `<div class="query-block" data-query="${escapeAttr(token.text)}"></div>`
      }
      return false
    },
    link(token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens)
      if (token.href.startsWith('wikilink://')) {
        const target = decodeURIComponent(token.href.slice('wikilink://'.length))
        return `<a class="wikilink" href="#" data-wikilink="${escapeAttr(
          target
        )}" title="双链: ${escapeAttr(target)}">${text}</a>`
      }
      return `<a href="${escapeAttr(token.href)}" target="_blank" rel="noreferrer">${text}</a>`
    },
    blockquote(token: Tokens.Blockquote): string {
      const raw = token.raw
      const lines = raw.split('\n')
      const headerLine = (lines[0] ?? '').replace(/^>\s?/, '')
      const header = parseCalloutHeader(headerLine)
      if (!header) {
        return `<blockquote>${this.parser.parse(token.tokens)}</blockquote>`
      }
      const bodyRaw = lines
        .slice(1)
        .map((line) => line.replace(/^>\s?/, ''))
        .join('\n')
      const bodyHtml = bodyRaw.trim() ? (marked.parse(bodyRaw, { async: false }) as string) : ''
      const title = header.title || header.type
      return `<div class="callout callout-${header.type}"><div class="callout-title">${escapeHtml(
        title
      )}</div><div class="callout-body">${bodyHtml}</div></div>`
    }
  }
})

/** 渲染 Markdown 为 HTML（未做 XSS 净化，调用方需 DOMPurify） */
export function renderMarkdown(content: string): string {
  const withLinks = preprocessWikilinks(content)
  const { body } = preprocessFootnotes(withLinks)
  return marked.parse(body, { async: false }) as string
}
