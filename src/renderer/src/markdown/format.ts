/**
 * Markdown 格式化指令（Word 常用操作的等价物）。
 *
 * 分两类：
 * - 纯字符串操作（预览栏用：按块 raw 替换）
 * - CodeMirror 命令（编辑器用：直接改 view）
 */
import type { EditorView } from '@codemirror/view'

export type InlineFormatKey = 'bold' | 'italic' | 'strike' | 'code' | 'highlight'

export const INLINE_FORMATS: Record<InlineFormatKey, { left: string; right: string }> = {
  bold: { left: '**', right: '**' },
  italic: { left: '*', right: '*' },
  strike: { left: '~~', right: '~~' },
  code: { left: '`', right: '`' },
  highlight: { left: '==', right: '==' }
}

/** 把选中文字包上标记；已包裹则取消（Word 的 Cmd+B 是切换语义） */
export function wrapText(text: string, format: InlineFormatKey): string {
  const { left, right } = INLINE_FORMATS[format]
  if (text.startsWith(left) && text.endsWith(right) && text.length > left.length + right.length) {
    return text.slice(left.length, text.length - right.length)
  }
  return `${left}${text}${right}`
}

/** 给多行文本加行首标记（标题 / 列表 / 引用），已存在则移除 */
export function prefixLines(text: string, prefix: string): string {
  const lines = text.split('\n')
  const allHave = lines.every((line) => line.trim() === '' || line.startsWith(prefix))
  return lines
    .map((line) => {
      if (line.trim() === '') return line
      if (allHave) return line.slice(prefix.length)
      // 去掉已有的同类前缀，避免 `## ## 标题`
      const stripped = line.replace(/^(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/, '')
      return `${prefix}${stripped}`
    })
    .join('\n')
}

/** 编号列表：按行序生成 1. 2. 3. */
export function numberLines(text: string): string {
  const lines = text.split('\n')
  const numbered = lines.every((line) => line.trim() === '' || /^\d+\.\s/.test(line))
  let index = 0
  return lines
    .map((line) => {
      if (line.trim() === '') return line
      if (numbered) return line.replace(/^\d+\.\s+/, '')
      index += 1
      return `${index}. ${line.replace(/^([-*+]\s+|\d+\.\s+)/, '')}`
    })
    .join('\n')
}

/**
 * 在块的 raw 中定位选中文字并套用行内格式。
 * 返回 null 表示没找到（通常是渲染后与源码差异较大），调用方应降级。
 */
export function applyInlineToBlock(
  raw: string,
  selected: string,
  format: InlineFormatKey
): string | null {
  const text = selected.trim()
  if (!text) return null
  const index = raw.indexOf(text)
  if (index >= 0) {
    const wrapped = wrapText(text, format)
    return raw.slice(0, index) + wrapped + raw.slice(index + text.length)
  }
  return null
}

// ---------------------------------------------------------------------------
// CodeMirror 命令
// ---------------------------------------------------------------------------

function replaceSelection(view: EditorView, transform: (text: string) => string): boolean {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const next = transform(selected)
  view.dispatch({
    changes: { from, to, insert: next },
    selection: { anchor: from, head: from + next.length },
    scrollIntoView: true
  })
  view.focus()
  return true
}

/** 行内格式（选中为空时插入占位符并选中它，方便直接输入） */
export function formatSelection(view: EditorView, format: InlineFormatKey): boolean {
  const { from, to } = view.state.selection.main
  if (from === to) {
    const { left, right } = INLINE_FORMATS[format]
    const placeholder = '文本'
    const insert = `${left}${placeholder}${right}`
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + left.length, head: from + left.length + placeholder.length }
    })
    view.focus()
    return true
  }
  return replaceSelection(view, (text) => wrapText(text, format))
}

/** 标题级别（0 = 正文）；作用于光标所在行或选中行 */
export function setHeading(view: EditorView, level: number): boolean {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let n = startLine; n <= endLine; n += 1) {
    const line = view.state.doc.line(n)
    const text = line.text.replace(/^#{1,6}\s+/, '')
    const prefix = level > 0 ? `${'#'.repeat(level)} ` : ''
    changes.push({ from: line.from, to: line.to, insert: `${prefix}${text}` })
  }
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
  return true
}

/** 行前缀：无序列表 / 引用 */
export function toggleLines(view: EditorView, prefix: string): boolean {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let n = startLine; n <= endLine; n += 1) {
    const line = view.state.doc.line(n)
    changes.push({ from: line.from, to: line.to, insert: prefixLines(line.text, prefix) })
  }
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
  return true
}

/** 编号列表 */
export function toggleNumberedList(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  const text = view.state.sliceDoc(
    view.state.doc.line(startLine).from,
    view.state.doc.line(endLine).to
  )
  const next = numberLines(text)
  view.dispatch({
    changes: {
      from: view.state.doc.line(startLine).from,
      to: view.state.doc.line(endLine).to,
      insert: next
    }
  })
  view.focus()
  return true
}

/** 插入链接：选中文字变成 [选中](url)，未选中则插入模板 */
export function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to) || '链接文字'
  const insert = `[${selected}](https://)`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - 1 - 8, head: from + insert.length - 1 }
  })
  view.focus()
  return true
}

/** 插入表格（Word 的"插入表格"） */
export function insertTable(view: EditorView, rows = 2, cols = 2): boolean {
  const header = `| ${Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const body = Array.from(
    { length: rows },
    () => `| ${Array.from({ length: cols }, () => '   ').join(' | ')} |`
  ).join('\n')
  const insert = `${header}\n${divider}\n${body}`
  const { from } = view.state.selection.main
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length }
  })
  view.focus()
  return true
}


// ---------------------------------------------------------------------------
// 编辑辅助：Tab 缩进 / Shift-Tab 反缩进 / 回车续写列表
// ---------------------------------------------------------------------------

/** Tab：有选区时整段缩进 2 空格，否则在光标处插入 2 空格 */
export function indent(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  if (from === to) {
    view.dispatch({
      changes: { from, insert: '  ' },
      selection: { anchor: from + 2 }
    })
    return true
  }
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  const changes: Array<{ from: number; insert: string }> = []
  for (let n = startLine; n <= endLine; n += 1) {
    changes.push({ from: view.state.doc.line(n).from, insert: '  ' })
  }
  view.dispatch({ changes })
  return true
}

/** Shift-Tab：去掉行首最多 2 个空格（或一个 Tab） */
export function outdent(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let n = startLine; n <= endLine; n += 1) {
    const line = view.state.doc.line(n)
    const match = /^(\t| {1,2})/.exec(line.text)
    if (!match) continue
    changes.push({ from: line.from, to: line.from + match[0].length, insert: '' })
  }
  if (changes.length === 0) return true
  view.dispatch({ changes })
  return true
}

/**
 * Enter：在列表项里自动续写标记；空列表项则结束列表。
 * 返回 false 表示交给编辑器默认插入换行。
 */
/** 纯逻辑：给定光标前的行内容，算出回车后应插入的文本（null=不处理） */
export function listContinuation(before: string): { insert: string; clearLine?: boolean } | null {
  const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(before)
  if (!match) return null
  const [, indent, marker, content] = match
  if (!content.trim()) return { insert: '', clearLine: true }
  const nextMarker = /^\d+\.$/.test(marker!)
    ? `${Number.parseInt(marker!, 10) + 1}.`
    : marker!
  return { insert: `\n${indent}${nextMarker} ` }
}

export function continueList(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  if (from !== to) return false
  const line = view.state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from)
  const next = listContinuation(before)
  if (!next) return false

  if (next.clearLine) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from }
    })
    return true
  }

  view.dispatch({
    changes: { from, insert: next.insert },
    selection: { anchor: from + next.insert.length }
  })
  return true
}
