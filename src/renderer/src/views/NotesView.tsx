import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  linksApi,
  type BacklinkInfo,
  type NoteDoc,
  type NoteMeta,
  type NoteSearchHit,
  type UnlinkedMention
} from '../api'
import { NoteEditor, type NoteEditorHandle } from '../components/NoteEditor'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { FileTree } from '../components/FileTree'
import { LinksPanel } from '../components/LinksPanel'
import { OutlinePanel } from '../components/OutlinePanel'
import { PropertiesEditor } from '../components/PropertiesEditor'
import { DailyPanel } from '../components/DailyPanel'
import { EditorRail } from '../components/EditorRail'

type SaveStatus = 'saved' | 'saving' | 'dirty'

const AUTOSAVE_DELAY = 800

export function NotesView(): React.JSX.Element {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [doc, setDoc] = useState<NoteDoc | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NoteSearchHit[]>([])
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [vaultPath, setVaultPath] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'outline' | 'links'>('outline')
  const [backlinks, setBacklinks] = useState<BacklinkInfo[]>([])
  const [unlinked, setUnlinked] = useState<UnlinkedMention[]>([])
  const [dailyOpen, setDailyOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const editorRef = useRef<NoteEditorHandle>(null)

  // 编辑区宽度（px）与折叠态，持久化到 localStorage
  const [editorWidth, setEditorWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('secbrain.editor.width.v2'))
    return Number.isFinite(saved) && saved >= 240 ? saved : 0
  })
  const [editorCollapsed, setEditorCollapsed] = useState(
    () => localStorage.getItem('secbrain.editor.collapsed.v2') === '1'
  )
  const bodyRef = useRef<HTMLDivElement>(null)

  const toggleEditor = (): void => {
    setEditorCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('secbrain.editor.collapsed.v2', next ? '1' : '0')
      return next
    })
  }

  /** 拖拽分隔条调整编辑区宽度 */
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const body = bodyRef.current
    if (!body) return
    event.preventDefault()
    const rect = body.getBoundingClientRect()
    const onMove = (moveEvent: PointerEvent): void => {
      const next = Math.min(rect.width - 280, Math.max(240, moveEvent.clientX - rect.left))
      setEditorWidth(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setEditorWidth((width) => {
        if (width > 0) localStorage.setItem('secbrain.editor.width.v2', String(Math.round(width)))
        return width
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingContentRef = useRef<string | null>(null)
  const pendingTitleRef = useRef<string | null>(null)
  // 供定时器回调读取最新值，避免闭包过期
  const activePathRef = useRef<string | null>(null)
  const docRef = useRef<NoteDoc | null>(null)

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])
  useEffect(() => {
    docRef.current = doc
  }, [doc])

  const refreshList = useCallback(async () => {
    setNotes(await api.listNotes())
  }, [])

  // 初始加载 + 订阅 vault 变更（不依赖 activePath，用 ref 读取）
  useEffect(() => {
    void refreshList()
    void api.getVaultPath().then(setVaultPath)
    const unsubscribe = api.onVaultChanged((change) => {
      if (change.type === 'tree') {
        // 目录结构变化（或切换 Vault）：刷新列表，当前笔记若已不存在则关闭
        void api.listNotes().then((list) => {
          setNotes(list)
          if (activePathRef.current && !list.some((n) => n.path === activePathRef.current)) {
            setActivePath(null)
            setDoc(null)
          }
        })
        return
      }
      void refreshList()
      if (activePathRef.current !== change.path) return
      if (change.type === 'delete') {
        setActivePath(null)
        setDoc(null)
        return
      }
      // 外部工具改动了当前笔记：仅当本地无未保存编辑时才重载
      if (pendingContentRef.current === null && pendingTitleRef.current === null) {
        void api.readNote(change.path).then((next) => {
          if (next) setDoc(next)
        })
      }
    })
    return unsubscribe
  }, [refreshList])

  // 搜索（防抖）
  useEffect(() => {
    if (!query.trim()) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      void api.searchNotes(query).then(setHits)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const scheduleSave = useCallback(() => {
    setStatus('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const path = activePathRef.current
      if (!path) return
      // 只改了标题时 content 为 null，回退到当前文档正文
      const content = pendingContentRef.current ?? docRef.current?.content ?? ''
      const title = pendingTitleRef.current ?? undefined
      setStatus('saving')
      void api
        .updateNote({ path, content, title })
        .then((saved) => {
          pendingContentRef.current = null
          pendingTitleRef.current = null
          setDoc(saved)
          setStatus('saved')
          void refreshList()
          if (infoOpen) void refreshLinks(saved.path)
        })
        .catch(() => {
          setStatus('dirty')
        })
    }, AUTOSAVE_DELAY)
  }, [refreshList])

  const openNote = useCallback(async (path: string) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingContentRef.current = null
    pendingTitleRef.current = null
    const next = await api.readNote(path)
    if (!next) return
    setDoc(next)
    setActivePath(path)
    setStatus('saved')
  }, [])

  const refreshLinks = useCallback(async (path: string) => {
    const [nextBacklinks, nextUnlinked] = await Promise.all([
      linksApi.backlinks(path),
      linksApi.unlinked(path)
    ])
    setBacklinks(nextBacklinks)
    setUnlinked(nextUnlinked)
  }, [])

  // 切换笔记 / 打开链接面板时加载反向链接与未链接提及
  useEffect(() => {
    if (!doc || !infoOpen) return
    void refreshLinks(doc.path)
  }, [doc, infoOpen, refreshLinks])

  // 响应命令面板/快速切换器的“打开指定笔记”事件
  useEffect(() => {
    const onOpenNote = (event: Event): void => {
      const path = (event as CustomEvent<string>).detail
      if (typeof path === 'string') {
        setQuery('')
        void openNote(path)
      }
    }
    const onOpenDaily = (): void => setDailyOpen(true)
    window.addEventListener('secbrain:open-note', onOpenNote)
    window.addEventListener('secbrain:open-daily-panel', onOpenDaily)
    return () => {
      window.removeEventListener('secbrain:open-note', onOpenNote)
      window.removeEventListener('secbrain:open-daily-panel', onOpenDaily)
    }
  }, [openNote])

  const handleContentChange = useCallback(
    (content: string) => {
      pendingContentRef.current = content
      setDoc((prev) => (prev ? { ...prev, content } : prev))
      scheduleSave()
    },
    [scheduleSave]
  )

  const handleTitleChange = useCallback(
    (title: string) => {
      pendingTitleRef.current = title
      setDoc((prev) => (prev ? { ...prev, title } : prev))
      scheduleSave()
    },
    [scheduleSave]
  )

  const handleDelete = useCallback(async () => {
    const path = activePathRef.current
    if (!path) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingContentRef.current = null
    pendingTitleRef.current = null
    await api.deleteNote(path)
    setActivePath(null)
    setDoc(null)
    void refreshList()
  }, [refreshList])

  const handleSaveAttachment = useCallback(
    async (dataUrl: string, filename: string): Promise<string> => {
      const path = activePathRef.current
      if (!path) return ''
      const result = await api.saveAttachment({ notePath: path, filename, dataUrl })
      return result.markdown
    },
    []
  )

  const listItems = useMemo(() => {
    if (query.trim() && hits.length > 0) {
      return hits.map((h) => ({ path: h.path, title: h.title, snippet: h.snippet }))
    }
    return notes.map((n) => ({ path: n.path, title: n.title, snippet: null }))
  }, [notes, hits, query])

  const statusLabel = status === 'saved' ? '已保存' : status === 'saving' ? '保存中…' : '未保存'

  return (
    <div className="notes-view">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-actions">
          <input
            className="search-input"
            placeholder="搜索笔记…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {query.trim() && hits.length > 0 ? (
          <ul className="note-list">
            {listItems.map((item) => (
              <li
                key={item.path}
                className={`note-list-item ${item.path === activePath ? 'active' : ''}`}
                onClick={() => void openNote(item.path)}
              >
                <div className="note-list-title">{item.title}</div>
                <div
                  className="note-list-snippet"
                  dangerouslySetInnerHTML={{ __html: item.snippet ?? '' }}
                />
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <ul className="note-list">
            <li className="note-list-empty">没有匹配的笔记</li>
          </ul>
        ) : (
          <FileTree activePath={activePath} onOpenNote={openNote} />
        )}
        <div className="vault-path" title={vaultPath}>
          Vault: {vaultPath}
        </div>
      </aside>

      {dailyOpen && (
        <DailyPanel
          onOpenNote={(path) => void openNote(path)}
          onClose={() => setDailyOpen(false)}
        />
      )}

      <section className="notes-main">
        {doc ? (
          <>
            <header className="note-header">
              <input
                className="title-input"
                value={doc.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="笔记标题"
              />
              <div className="note-tags">
                {doc.tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    #{tag}
                  </span>
                ))}
              </div>
              <div className="note-header-right">
                <span className={`save-status ${status}`}>{statusLabel}</span>
                <button
                  className={`btn-ghost ${editorCollapsed ? 'active' : ''}`}
                  onClick={toggleEditor}
                  title={editorCollapsed ? '展开编辑区' : '折叠为行号缩略'}
                >
                  {editorCollapsed ? '⇥ 展开' : '⇤ 折叠'}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setPropsOpen(true)}
                  title="编辑 front-matter 属性"
                >
                  ⚙ 属性
                </button>
                <button
                  className={`btn-ghost ${infoOpen ? 'active' : ''}`}
                  onClick={() => setInfoOpen((v) => !v)}
                  title="大纲 / 反向链接"
                >
                  ☰ 面板
                </button>
                <button className="btn-danger" onClick={() => void handleDelete()}>
                  删除
                </button>
              </div>
            </header>
            <div className="note-body" ref={bodyRef}>
              {editorCollapsed ? (
                <div className="editor-pane collapsed" style={{ width: 56, flex: 'none' }}>
                  <button
                    type="button"
                    className="editor-rail-expand"
                    title="展开编辑区"
                    onClick={toggleEditor}
                  >
                    ›
                  </button>
                  <EditorRail
                    lineCount={doc.content.split('\n').length}
                    onJump={(line) => {
                      setEditorCollapsed(false)
                      localStorage.setItem('secbrain.editor.collapsed.v2', '0')
                      window.setTimeout(() => editorRef.current?.gotoLine(line), 60)
                    }}
                  />
                </div>
              ) : (
                <div
                  className="editor-pane"
                  style={editorWidth > 0 ? { width: editorWidth, flex: 'none' } : undefined}
                >
                  <NoteEditor
                    ref={editorRef}
                    content={doc.content}
                    onChange={handleContentChange}
                    onSaveAttachment={handleSaveAttachment}
                  />
                  <div
                    className="pane-divider"
                    onPointerDown={startResize}
                    onDoubleClick={toggleEditor}
                    title="拖拽调整宽度，双击折叠/展开"
                  >
                    <button
                      type="button"
                      className="pane-divider-toggle"
                      title="折叠为行号栏"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={toggleEditor}
                    >
                      ‹
                    </button>
                  </div>
                </div>
              )}
              <MarkdownPreview
                content={doc.content}
                notePath={doc.path}
                onContentChange={handleContentChange}
                onCaretSync={(offset) => {
                  // 折叠状态先展开，再等编辑器挂载后放光标
                  if (editorCollapsed) {
                    setEditorCollapsed(false)
                    localStorage.setItem('secbrain.editor.collapsed.v2', '0')
                    window.setTimeout(() => editorRef.current?.gotoOffset(offset), 90)
                    return
                  }
                  editorRef.current?.gotoOffset(offset)
                }}
              />
              {infoOpen && (
                <aside className="links-panel">
                  <div className="links-panel-header">
                    <div className="panel-tabs">
                      <button
                        className={panelTab === 'outline' ? 'active' : ''}
                        onClick={() => setPanelTab('outline')}
                      >
                        大纲
                      </button>
                      <button
                        className={panelTab === 'links' ? 'active' : ''}
                        onClick={() => setPanelTab('links')}
                      >
                        链接
                      </button>
                    </div>
                    <button className="btn-ghost" onClick={() => setInfoOpen(false)} title="收起">
                      ✕
                    </button>
                  </div>
                  {panelTab === 'outline' ? (
                    <OutlinePanel
                      content={doc.content}
                      onJump={(line) => editorRef.current?.gotoLine(line)}
                    />
                  ) : (
                    <LinksPanel
                      backlinks={backlinks}
                      unlinked={unlinked}
                      onOpenNote={(path) => void openNote(path)}
                    />
                  )}
                </aside>
              )}
            </div>
            {propsOpen && (
              <PropertiesEditor
                doc={doc}
                onClose={() => setPropsOpen(false)}
                onSaved={(next) => {
                  setDoc(next)
                  void refreshList()
                }}
              />
            )}
          </>
        ) : (
          <div className="notes-empty">从左侧选择一篇笔记，或点击「新建」开始记录</div>
        )}
      </section>
    </div>
  )
}
