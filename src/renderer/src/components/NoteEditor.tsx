import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { basicSetup, EditorView } from 'codemirror'
import { keymap } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { api, type NoteMeta } from '../api'
import { fuzzyScore } from '../commands/registry'
import {
  continueList,
  formatSelection,
  indent,
  insertLink,
  outdent,
  setHeading,
  toggleLines,
  toggleNumberedList
} from '../markdown/format'

interface NoteEditorProps {
  content: string
  onChange: (content: string) => void
  /** 保存附件并返回可插入的 Markdown 文本 */
  onSaveAttachment: (dataUrl: string, filename: string) => Promise<string>
}

export interface NoteEditorHandle {
  /** 跳转到指定行（1-based）并聚焦 */
  gotoLine: (line: number) => void
  /** 把光标放到指定字符偏移处并聚焦（预览里回车后"光标跟随"用） */
  gotoOffset: (offset: number) => void
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { content, onChange, onSaveAttachment },
  ref
): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      gotoLine: (line: number) => {
        const view = viewRef.current
        if (!view) return
        const safeLine = Math.min(Math.max(1, line), view.state.doc.lines)
        const info = view.state.doc.line(safeLine)
        view.dispatch({ selection: { anchor: info.from }, scrollIntoView: true })
        view.focus()
      },
      gotoOffset: (offset: number) => {
        const view = viewRef.current
        if (!view) return
        const safe = Math.min(Math.max(0, offset), view.state.doc.length)
        view.dispatch({ selection: { anchor: safe }, scrollIntoView: true })
        view.focus()
      }
    }),
    []
  )
  // 始终持有最新回调，避免闭包捕获到旧笔记的 activePath
  const onChangeRef = useRef(onChange)
  const onSaveAttachmentRef = useRef(onSaveAttachment)
  onChangeRef.current = onChange
  onSaveAttachmentRef.current = onSaveAttachment
  // 程序化同步文档期间抑制 onChange，避免幻影保存
  const syncingRef = useRef(false)
  // 笔记与附件列表（用于 [[ / ![[ 自动补全）
  const notesRef = useRef<NoteMeta[]>([])
  const filesRef = useRef<string[]>([])

  useEffect(() => {
    const refresh = (): void => {
      void api.listNotes().then((notes) => {
        notesRef.current = notes
      })
      void api.getTree().then((tree) => {
        const files: string[] = []
        const walk = (nodes: Array<{ kind: 'file' | 'folder'; path: string; children?: unknown[] }>): void => {
          for (const node of nodes) {
            if (node.kind === 'file' && !/\.md$/i.test(node.path)) files.push(node.path)
            if (node.children) walk(node.children as typeof nodes)
          }
        }
        walk(tree as never)
        filesRef.current = files
      })
    }
    refresh()
    return api.onVaultChanged(() => refresh())
  }, [])

  /** [[ 触发笔记补全，![[ 触发附件嵌入补全；选中后自动补全 ]] 并定位光标 */
  const wikiLinkCompletion = (context: CompletionContext) => {
    const word = context.matchBefore(/!?\[\[[^\]\n]{0,60}$/)
    if (!word) return null
    const isEmbed = word.text.startsWith('!')
    const prefixLength = isEmbed ? 3 : 2
    const query = word.text.slice(prefixLength)

    const noteOptions = notesRef.current
      .map((note) => ({ note, score: fuzzyScore(query, `${note.title} ${note.path}`) }))
      .filter((item): item is { note: NoteMeta; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, isEmbed ? 6 : 15)
      .map(({ note }) => ({
        label: note.title,
        detail: note.path,
        apply: (view: EditorView, _completion: unknown, from: number, to: number): void => {
          const insert = isEmbed ? `![[${note.title}]]` : `${note.title}]]`
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length }
          })
        }
      }))

    const fileOptions = filesRef.current
      .map((path) => ({ path, score: fuzzyScore(query, path) }))
      .filter((item): item is { path: string; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, isEmbed ? 15 : 6)
      .map(({ path }) => {
        const name = path.split('/').pop() ?? path
        return {
          label: name,
          detail: path,
          apply: (view: EditorView, _completion: unknown, from: number, to: number): void => {
            const select = isEmbed ? name : path
            const insert = isEmbed ? `![[${select}]]` : `${select}]]`
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length }
            })
          }
        }
      })

    const options = isEmbed ? [...fileOptions, ...noteOptions] : [...noteOptions, ...fileOptions]
    if (options.length === 0) return null
    return {
      from: isEmbed ? word.from : word.from + 2,
      options,
      validFor: /^[^\]\n]*$/
    }
  }

  // 初始化编辑器（仅一次）
  useEffect(() => {
    if (!containerRef.current) return
    const state = EditorState.create({
      doc: content,
      extensions: [
        // Word 风格格式化快捷键（放在默认 keymap 之前，优先生效）
        Prec.highest(
          keymap.of([
            { key: 'Mod-b', run: (view: EditorView) => formatSelection(view, 'bold') },
            { key: 'Mod-i', run: (view: EditorView) => formatSelection(view, 'italic') },
            { key: 'Mod-Shift-x', run: (view: EditorView) => formatSelection(view, 'strike') },
            { key: 'Mod-Shift-h', run: (view: EditorView) => formatSelection(view, 'highlight') },
            { key: 'Mod-k', run: (view: EditorView) => insertLink(view) },
            { key: 'Mod-Alt-1', run: (view: EditorView) => setHeading(view, 1) },
            { key: 'Mod-Alt-2', run: (view: EditorView) => setHeading(view, 2) },
            { key: 'Mod-Alt-3', run: (view: EditorView) => setHeading(view, 3) },
            { key: 'Mod-Alt-0', run: (view: EditorView) => setHeading(view, 0) },
            { key: 'Mod-Shift-8', run: (view: EditorView) => toggleLines(view, '- ') },
            { key: 'Mod-Shift-7', run: (view: EditorView) => toggleNumberedList(view) },
            { key: 'Mod-Shift-9', run: (view: EditorView) => toggleLines(view, '> ') },
            // 常用编辑：Tab 缩进 / Shift-Tab 反缩进 / 列表内回车续写
            { key: 'Tab', run: (view: EditorView) => indent(view) },
            { key: 'Shift-Tab', run: (view: EditorView) => outdent(view) },
            { key: 'Enter', run: (view: EditorView) => continueList(view) }
          ])
        ),
        basicSetup,
        markdown({ base: markdownLanguage }),
        oneDark,
        EditorView.lineWrapping,
        autocompletion({ override: [wikiLinkCompletion], icons: false }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const items = event.clipboardData?.items
            if (!items) return false
            for (const item of items) {
              if (!item.type.startsWith('image/')) continue
              const file = item.getAsFile()
              if (!file) continue
              const pos = view.state.selection.main.head
              void readAsDataUrl(file)
                .then((dataUrl) => onSaveAttachmentRef.current(dataUrl, file.name || 'pasted.png'))
                .then((markdown) => {
                  view.dispatch({
                    changes: { from: pos, insert: markdown },
                    selection: { anchor: pos + markdown.length }
                  })
                })
                .catch(() => {
                  /* 附件保存失败时静默 */
                })
              return true
            }
            return false
          }
        })
      ]
    })
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // content 仅在挂载时读取；后续外部同步走下方 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部内容变化（切换笔记）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() === content) return
    syncingRef.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content }
      })
    } finally {
      syncingRef.current = false
    }
  }, [content])

  return <div className="note-editor" ref={containerRef} />
})

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
