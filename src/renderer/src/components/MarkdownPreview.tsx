import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  isPreviewable,
  parseVaultFileUrl,
  resolveRelativePath,
  rewriteImageSources
} from '../../../shared/asset-url'
import { api } from '../api'
import { openFileViewer } from './FileViewer'
import { renderMarkdown } from '../markdown/render'
import { splitBlocks } from '../markdown/blocks'
import { canEditVisually, htmlToMarkdown } from '../markdown/html-to-md'
import { applyInlineToBlock, prefixLines, type InlineFormatKey } from '../markdown/format'
import { hydrateQueryBlocks, hydrateRichContent } from '../markdown/hydrate'
import 'katex/dist/katex.min.css'

interface MarkdownPreviewProps {
  content: string
  /** 当前笔记的 vault 相对路径（用于解析相对图片路径） */
  notePath: string
  /** 预览栏编辑后回写源码（与编辑器共用同一份内容，天然双向同步） */
  onContentChange?: (next: string) => void
  /** 回车后把光标交回左侧编辑器（字符偏移），实现"光标跟随" */
  onCaretSync?: (offset: number) => void
}

/** 正在编辑的块：visual=真·所见即所得（contentEditable），否则退回源码 textarea */
interface EditingBlock {
  start: number
  end: number
  html: string
  raw: string
  visual: boolean
  /** 点击位置（用于把光标放到点的地方，而不是永远跳到末尾） */
  point?: { x: number; y: number }
}

export function MarkdownPreview({
  content,
  notePath,
  onContentChange,
  onCaretSync
}: MarkdownPreviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editableRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<EditingBlock | null>(null)
  /** 选中文字后弹出的格式工具条（Word 的浮动工具栏） */
  const [toolbar, setToolbar] = useState<{
    x: number
    y: number
    start: number
    end: number
    selected: string
  } | null>(null)

  const blocks = useMemo(() => splitBlocks(content), [content])
  const rendered = useMemo(
    () =>
      blocks.map((block) => ({
        ...block,
        html: rewriteImageSources(DOMPurify.sanitize(renderMarkdown(block.raw)), notePath)
      })),
    [blocks, notePath]
  )

  // 水合：KaTeX 公式、Mermaid 图表与 Dataview 查询（失败降级为原文）
  useEffect(() => {
    if (!containerRef.current) return
    void hydrateRichContent(containerRef.current)
    void hydrateQueryBlocks(containerRef.current)
  }, [rendered])

  // 进入编辑后把光标放到块末尾，等同 Word 里点进去就能打字
  useEffect(() => {
    if (!editing?.visual) return
    const el = editableRef.current
    if (!el) return
    el.focus()
    const selection = window.getSelection()
    const point = editing.point
    const caret =
      point && 'caretRangeFromPoint' in document
        ? (document as Document & { caretRangeFromPoint: (x: number, y: number) => Range | null })
            .caretRangeFromPoint(point.x, point.y)
        : null
    if (caret) {
      selection?.removeAllRanges()
      selection?.addRange(caret)
      return
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [editing])

  /** 光标当前位置 → 该块 Markdown 的字符长度（用于回写后定位编辑器光标） */
  const markdownOffsetAtCaret = (root: HTMLElement): number => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return 0
    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer)) return 0
    const prefix = document.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(range.startContainer, range.startOffset)
    const wrapper = document.createElement('div')
    wrapper.appendChild(prefix.cloneContents())
    return htmlToMarkdown(wrapper.innerHTML).length + 2
  }

  const commitVisual = (): void => {
    if (!editing) return
    const html = editableRef.current?.innerHTML ?? editing.html
    const markdown = htmlToMarkdown(html)
    const next = content.slice(0, editing.start) + markdown + content.slice(editing.end)
    if (next !== content) onContentChange?.(next)
    setEditing(null)
  }

  const commitSource = (value: string): void => {
    if (!editing) return
    const next = content.slice(0, editing.start) + value + content.slice(editing.end)
    if (next !== content) onContentChange?.(next)
    setEditing(null)
  }

  /** 把格式应用到"选中文字所在块"的源码（未进入编辑态时） */
  const applyFormat = (format: InlineFormatKey | { prefix: string }, target = toolbar): void => {
    if (!target || !onContentChange) return
    const block = blocks.find((item) => item.start === target.start)
    if (!block) return
    const next =
      typeof format === 'string'
        ? applyInlineToBlock(block.raw, target.selected, format)
        : prefixLines(block.raw, format.prefix)
    if (next === null) {
      // 源码里定位不到：直接进入可视化编辑，让用户手动改
      setEditing({
        start: block.start,
        end: block.end,
        html: rendered.find((item) => item.start === block.start)?.html ?? '',
        raw: block.raw,
        visual: true
      })
      setToolbar(null)
      return
    }
    onContentChange(content.slice(0, block.start) + next + content.slice(block.end))
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
  }

  /** 选中预览里的文字 → 记录所属块并弹出工具条 */
  const captureSelection = (): void => {
    if (!onContentChange || editing) return
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    if (!selection || !text) {
      setToolbar(null)
      return
    }
    const node = selection.anchorNode
    const element =
      node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : (node?.parentElement ?? null)
    const blockEl = element?.closest('[data-block-start]') as HTMLElement | null
    if (!blockEl) {
      setToolbar(null)
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    setToolbar({
      x: rect.left + rect.width / 2,
      y: rect.top,
      start: Number(blockEl.dataset.blockStart),
      end: Number(blockEl.dataset.blockEnd),
      selected: text
    })
  }

  // 点击图片 / 本地文件链接 / 双链 → 内置查看器或跳转
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const image = target.closest('img')
    if (image) {
      const src = image.getAttribute('src') ?? ''
      const rel = parseVaultFileUrl(src)
      if (rel) {
        event.preventDefault()
        openFileViewer(rel)
      }
      return
    }
    const anchor = target.closest('a')
    if (!anchor) return

    const wikiTarget = anchor.getAttribute('data-wikilink')
    if (wikiTarget) {
      event.preventDefault()
      void (async () => {
        const notes = await api.listNotes()
        const key = wikiTarget.trim().toLowerCase().replace(/\.md$/i, '')
        const hit = notes.find(
          (n) =>
            n.title.toLowerCase() === key ||
            (n.path.split('/').pop() ?? '').toLowerCase().replace(/\.md$/i, '') === key
        )
        if (hit) {
          window.dispatchEvent(new CustomEvent('secbrain:open-note', { detail: hit.path }))
        }
      })()
      return
    }

    const href = anchor.getAttribute('href') ?? ''
    const rel = resolveRelativePath(href, notePath)
    if (!rel) return
    event.preventDefault()
    if (/\.md$/i.test(rel)) {
      window.dispatchEvent(new CustomEvent('secbrain:open-note', { detail: rel }))
    } else if (isPreviewable(rel)) {
      openFileViewer(rel)
    } else {
      void api.openExternal(rel)
    }
  }

  /** 单击块 → 进入编辑（Word 逻辑：点哪改哪，不显示 Markdown 标记） */
  const enterEdit = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!onContentChange || editing) return
    // 正在拖选文字时不进入编辑，交给工具栏
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return
    const target = event.target as HTMLElement
    if (target.closest('a') || target.closest('img')) return
    const blockEl = target.closest('[data-block-start]') as HTMLElement | null
    if (!blockEl) return
    const start = Number(blockEl.dataset.blockStart)
    const end = Number(blockEl.dataset.blockEnd)
    const block = blocks.find((item) => item.start === start && item.end === end)
    const renderedBlock = rendered.find((item) => item.start === start)
    if (!block || !renderedBlock) return
    setToolbar(null)
    setEditing({
      start,
      end,
      html: renderedBlock.html,
      raw: block.raw,
      visual: canEditVisually(renderedBlock.html),
      point: { x: event.clientX, y: event.clientY }
    })
  }

  return (
    <div
      ref={containerRef}
      className="markdown-preview"
      onClick={handleClick}
      onMouseUp={captureSelection}
      tabIndex={-1}
    >
      {toolbar && !editing && (
        <div
          className="md-toolbar"
          style={{ left: toolbar.x, top: toolbar.y - 44 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button title="加粗 ⌘B" onClick={() => applyFormat('bold')}>
            <strong>B</strong>
          </button>
          <button title="斜体 ⌘I" onClick={() => applyFormat('italic')}>
            <em>I</em>
          </button>
          <button title="删除线 ⌘⇧X" onClick={() => applyFormat('strike')}>
            <s>S</s>
          </button>
          <button title="行内代码" onClick={() => applyFormat('code')}>
            {'</>'}
          </button>
          <span className="md-toolbar-sep" />
          <button title="标题 1" onClick={() => applyFormat({ prefix: '# ' })}>
            H1
          </button>
          <button title="标题 2" onClick={() => applyFormat({ prefix: '## ' })}>
            H2
          </button>
          <button title="标题 3" onClick={() => applyFormat({ prefix: '### ' })}>
            H3
          </button>
          <span className="md-toolbar-sep" />
          <button title="项目符号" onClick={() => applyFormat({ prefix: '- ' })}>
            •
          </button>
          <button title="编号列表" onClick={() => applyFormat({ prefix: '1. ' })}>
            1.
          </button>
          <button title="引用" onClick={() => applyFormat({ prefix: '> ' })}>
            ❝
          </button>
        </div>
      )}

      {rendered.map((block) => {
        const isEditing = editing?.start === block.start
        if (isEditing && editing.visual) {
          return (
            <div
              key={block.start}
              className="md-block-editing visual"
              contentEditable
              suppressContentEditableWarning
              ref={editableRef}
              // 初始内容来自渲染结果，编辑时浏览器直接改 DOM
              dangerouslySetInnerHTML={{ __html: editing.html }}
              onBlur={commitVisual}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                  return
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  commitVisual()
                  return
                }
                // Shift+Enter：软换行，留在预览里继续编辑
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault()
                  document.execCommand('insertLineBreak')
                  return
                }
                // Tab：插入两个空格（不跳出编辑）
                if (event.key === 'Tab' && !event.shiftKey) {
                  event.preventDefault()
                  document.execCommand('insertText', false, '  ')
                  return
                }
                // Shift+Tab：删掉光标前最多两个空格
                if (event.key === 'Tab' && event.shiftKey) {
                  event.preventDefault()
                  const selection = window.getSelection()
                  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
                  const node = range?.startContainer
                  if (range && node && node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent ?? ''
                    const before = text.slice(0, range.startOffset)
                    const match = /( {1,2}|\t)$/.exec(before)
                    if (match) {
                      range.setStart(node, range.startOffset - match[0].length)
                      range.deleteContents()
                    }
                  }
                  return
                }
                // 回车：换行后把光标交回左侧编辑器同一位置（Word 式连续书写）
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  const root = editableRef.current
                  if (!root) return

                  // 标题末尾回车 → 新起正文段落（Word 行为），其余 → 普通换行
                  const selection = window.getSelection()
                  const node = selection?.anchorNode
                  const element =
                    node?.nodeType === Node.ELEMENT_NODE
                      ? (node as HTMLElement)
                      : (node?.parentElement ?? null)
                  const heading = element?.closest('h1, h2, h3, h4, h5, h6') as HTMLElement | null
                  let atHeadingEnd = false
                  if (heading && selection?.rangeCount) {
                    const probe = selection.getRangeAt(0).cloneRange()
                    probe.setStart(probe.endContainer, probe.endOffset)
                    atHeadingEnd = probe.toString().trim() === ''
                  }

                  if (heading && atHeadingEnd && selection) {
                    const paragraph = document.createElement('p')
                    paragraph.appendChild(document.createElement('br'))
                    heading.after(paragraph)
                    const caret = document.createRange()
                    caret.setStart(paragraph, 0)
                    caret.collapse(true)
                    selection.removeAllRanges()
                    selection.addRange(caret)
                  } else {
                    document.execCommand('insertParagraph')
                  }

                  const offsetInBlock = markdownOffsetAtCaret(root)
                  const blockStart = editing.start
                  commitVisual()
                  if (onCaretSync) {
                    // 等内容写回、编辑器同步后再放光标
                    window.setTimeout(() => onCaretSync(blockStart + offsetInBlock), 40)
                  }
                }
              }}
            />
          )
        }
        if (isEditing) {
          return (
            <div key={block.start} className="md-block-editing">
              <textarea
                autoFocus
                defaultValue={editing.raw.trimEnd()}
                spellCheck={false}
                onBlur={(event) => commitSource(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setEditing(null)
                  }
                }}
              />
              <div className="md-block-hint">
                代码块 / 公式块用源码编辑 · Esc 取消 · 点空白处保存
              </div>
            </div>
          )
        }
        return (
          <div
            key={block.start}
            className="md-block"
            data-block-start={block.start}
            data-block-end={block.end}
            onClick={enterEdit}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        )
      })}
    </div>
  )
}
