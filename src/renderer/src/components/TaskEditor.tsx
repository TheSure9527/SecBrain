import { useEffect, useRef, useState } from 'react'
import { tasksApi, type NoteMeta, type Task, type TaskPriority } from '../api'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'
import { localToUtcIso, toDateStamp, utcIsoToLocal } from '../utils/dates'

interface TaskEditorProps {
  task: Task | null
  notes: NoteMeta[]
  onClose: () => void
  onSaved: () => void
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  0: '无优先级',
  1: '低',
  2: '中',
  3: '高'
}

export function TaskEditor({ task, notes, onClose, onSaved }: TaskEditorProps): React.JSX.Element {
  const isEdit = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [notesText, setNotesText] = useState(task?.notes ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 0)
  const [tagsText, setTagsText] = useState((task?.tags ?? []).join(', '))
  const [notePath, setNotePath] = useState(task?.notePath ?? '')

  const initial = (() => {
    if (task?.dueAt) {
      if (task.allDay) return { date: task.dueAt.slice(0, 10), time: '09:00', hasTime: false }
      const local = utcIsoToLocal(task.dueAt)
      return { date: local.date, time: local.time, hasTime: true }
    }
    return { date: toDateStamp(new Date()), time: '09:00', hasTime: false }
  })()
  const [hasDue, setHasDue] = useState(!!task?.dueAt)
  const [dueDate, setDueDate] = useState(initial.date)
  const [dueTime, setDueTime] = useState(initial.time)
  const [hasTime, setHasTime] = useState(initial.hasTime)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Mac 快捷键：Esc 关闭，⌘↵ 保存
  const saveRef = useRef<() => Promise<void>>(async () => {})
  saveRef.current = async () => {
    setError(null)
    if (!title.trim()) {
      setError('请填写任务标题')
      return
    }
    const dueAt = !hasDue ? null : hasTime ? localToUtcIso(dueDate, dueTime) : dueDate
    const tags = tagsText
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    setSaving(true)
    try {
      if (isEdit && task) {
        await tasksApi.update({
          id: task.id,
          title: title.trim(),
          notes: notesText,
          dueAt,
          allDay: !hasTime,
          priority,
          tags,
          notePath: notePath || null
        })
      } else {
        await tasksApi.create({
          title: title.trim(),
          notes: notesText,
          dueAt,
          allDay: !hasTime,
          priority,
          tags,
          notePath: notePath || null
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-editor" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{isEdit ? '编辑任务' : '新建任务'}</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>任务标题</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="要做什么？"
            />
          </label>

          <div className="field-row">
            <label className="field field-inline">
              <span>截止</span>
              <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />
            </label>
            {hasDue && (
              <label className="field field-inline">
                <span>具体时间</span>
                <input type="checkbox" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} />
              </label>
            )}
          </div>

          {hasDue && (
            <div className="field-row">
              <label className="field">
                <span>截止日期</span>
                <DatePicker value={dueDate} onChange={setDueDate} />
              </label>
              {hasTime && (
                <label className="field">
                  <span>截止时间</span>
                  <TimePicker value={dueTime} onChange={setDueTime} />
                </label>
              )}
            </div>
          )}

          <div className="field-row">
            <label className="field">
              <span>优先级</span>
              <select
                value={String(priority)}
                onChange={(e) => setPriority(Number(e.target.value) as TaskPriority)}
              >
                {([0, 1, 2, 3] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>关联笔记</span>
              <select value={notePath} onChange={(e) => setNotePath(e.target.value)}>
                <option value="">不关联</option>
                {notes.map((note) => (
                  <option key={note.path} value={note.path}>
                    {note.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>标签（逗号分隔）</span>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="工作, 重要"
            />
          </label>

          <label className="field">
            <span>备注</span>
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              rows={3}
              placeholder="可选"
            />
          </label>

          {error && <div className="form-error">{error}</div>}
        </div>

        <footer className="modal-footer">
          {isEdit && task && (
            <button
              className="btn-danger"
              onClick={() => {
                void tasksApi.delete(task.id).then(() => {
                  onSaved()
                  onClose()
                })
              }}
            >
              删除
            </button>
          )}
          <div className="footer-spacer" />
          <span className="shortcut-hint">⌘↵ 保存 · Esc 取消</span>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={saving} onClick={() => void saveRef.current()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}
