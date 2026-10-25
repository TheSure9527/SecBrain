import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta } from '../api'
import { filterCommands, fuzzyScore, type Command } from '../commands/registry'

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
  onOpenNote: (path: string) => void
}

/** ⌘P 命令面板：命令 + 笔记混合搜索 */
export function CommandPalette({ commands, onClose, onOpenNote }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.myzsk.listNotes().then(setNotes)
  }, [])

  const noteResults = useMemo(() => {
    if (!query.trim()) return []
    return notes
      .map((note) => ({ note, score: fuzzyScore(query, `${note.title} ${note.path}`) }))
      .filter((item): item is { note: NoteMeta; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => item.note)
  }, [query, notes])

  const commandResults = useMemo(() => filterCommands(query, commands), [query, commands])

  // 统一列表：命令在前，笔记在后
  const rows: Array<{ kind: 'command' | 'note'; key: string; title: string; hint?: string; run: () => void }> = [
    ...commandResults.map((cmd) => ({
      kind: 'command' as const,
      key: `cmd:${cmd.id}`,
      title: cmd.title,
      hint: cmd.shortcut ?? cmd.section,
      run: cmd.run
    })),
    ...noteResults.map((note) => ({
      kind: 'note' as const,
      key: `note:${note.path}`,
      title: note.title,
      hint: note.path,
      run: () => onOpenNote(note.path)
    }))
  ]

  useEffect(() => {
    setSelected(0)
  }, [query])

  const execute = (index: number): void => {
    const row = rows[index]
    if (!row) return
    row.run()
    onClose()
  }

  return (
    <div className="modal-overlay palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="搜索命令或笔记…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              execute(selected)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <ul className="palette-list">
          {rows.map((row, index) => (
            <li
              key={row.key}
              className={`palette-item ${index === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => execute(index)}
            >
              <span className="palette-item-icon">{row.kind === 'command' ? '⌘' : '📄'}</span>
              <span className="palette-item-title">{row.title}</span>
              {row.hint && <span className="palette-item-hint">{row.hint}</span>}
            </li>
          ))}
          {rows.length === 0 && <li className="palette-empty">没有匹配项</li>}
        </ul>
      </div>
    </div>
  )
}

interface QuickSwitcherProps {
  onClose: () => void
  onOpenNote: (path: string) => void
}

/** ⌘O 快速切换器：仅笔记，模糊搜索 */
export function QuickSwitcher({ onClose, onOpenNote }: QuickSwitcherProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.myzsk.listNotes().then(setNotes)
  }, [])

  const results = useMemo(() => {
    if (!query.trim()) return notes.slice(0, 20)
    return notes
      .map((note) => ({ note, score: fuzzyScore(query, `${note.title} ${note.path}`) }))
      .filter((item): item is { note: NoteMeta; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((item) => item.note)
  }, [query, notes])

  useEffect(() => {
    setSelected(0)
  }, [query])

  return (
    <div className="modal-overlay palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="跳转到笔记…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const note = results[selected]
              if (note) {
                onOpenNote(note.path)
                onClose()
              }
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <ul className="palette-list">
          {results.map((note, index) => (
            <li
              key={note.path}
              className={`palette-item ${index === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => {
                onOpenNote(note.path)
                onClose()
              }}
            >
              <span className="palette-item-icon">📄</span>
              <span className="palette-item-title">{note.title}</span>
              <span className="palette-item-hint">{note.path}</span>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">没有匹配的笔记</li>}
        </ul>
      </div>
    </div>
  )
}
