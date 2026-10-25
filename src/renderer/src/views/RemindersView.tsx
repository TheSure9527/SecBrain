import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  tasksApi,
  type CalendarMeta,
  type NoteMeta,
  type ReminderItem,
  type Task,
  type TaskFilter,
  type TaskPriority
} from '../api'
import { TaskEditor } from '../components/TaskEditor'

const FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完成' }
]

const PRIORITY_LABEL: Record<number, string> = { 0: '', 1: '低', 2: '中', 3: '高' }

interface Row {
  key: string
  kind: 'task' | 'reminder'
  title: string
  dueAt: string | null
  done: boolean
  priority: number
  notes: string
  calendarName?: string
  task?: Task
  reminder?: ReminderItem
}

function inRange(dueAt: string | null, filter: TaskFilter): boolean {
  if (filter === 'all' || filter === 'done') return true
  if (!dueAt) return false
  const due = new Date(dueAt.slice(0, 10))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (filter === 'today') return due.getTime() === today.getTime()
  // 本周：从今天起 7 天
  const end = new Date(today)
  end.setDate(end.getDate() + 7)
  return due >= today && due < end
}

/** 提醒事项：iCloud 提醒（VTODO） + 本地任务，统一在一个页面管理 */
export function RemindersView(): React.JSX.Element {
  const [filter, setFilter] = useState<TaskFilter>('today')
  const [tasks, setTasks] = useState<Task[]>([])
  const [reminders, setReminders] = useState<ReminderItem[]>([])
  const [reminderCalendars, setReminderCalendars] = useState<CalendarMeta[]>([])
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [counts, setCounts] = useState<Record<TaskFilter, number>>({
    today: 0,
    week: 0,
    all: 0,
    done: 0
  })
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ task: Task | null } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // 快速新增
  const todayStamp = new Date().toISOString().slice(0, 10)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickDate, setQuickDate] = useState(todayStamp)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quickPriority, setQuickPriority] = useState<TaskPriority>(0)
  const [target, setTarget] = useState('local')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextTasks, nextCounts, nextReminders, calendars] = await Promise.all([
        tasksApi.list(filter),
        tasksApi.counts(),
        api.calendar.listReminders(true),
        api.calendar.listReminderCalendars()
      ])
      setTasks(nextTasks)
      setCounts(nextCounts)
      setReminders(
        nextReminders
          .filter((item) => (filter === 'done' ? item.completed : !item.completed))
          .filter((item) => inRange(item.dueAt, filter))
      )
      setReminderCalendars(calendars)
      if (calendars.length > 0 && target === 'local') setTarget(calendars[0]!.id)
    } finally {
      setLoading(false)
    }
  }, [filter, target])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.listNotes().then(setNotes)
  }, [])

  const rows = useMemo<Row[]>(() => {
    const taskRows: Row[] = tasks.map((task) => ({
      key: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      dueAt: task.dueAt,
      done: task.status === 'done',
      priority: task.priority,
      notes: task.notes,
      task
    }))
    const reminderRows: Row[] = reminders.map((item) => ({
      key: `reminder:${item.calendarId}:${item.uid}`,
      kind: 'reminder',
      title: item.title,
      dueAt: item.dueAt,
      done: item.completed,
      priority: item.priority,
      notes: item.notes,
      calendarName: item.calendarName,
      reminder: item
    }))
    return [...taskRows, ...reminderRows].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt)
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return b.priority - a.priority
    })
  }, [tasks, reminders])

  const addItem = async (): Promise<void> => {
    const title = quickTitle.trim()
    if (!title) {
      setError('请先输入待办内容')
      return
    }
    setBusy('add')
    setError(null)
    setNotice(null)
    try {
      if (target === 'local') {
        await tasksApi.create({ title, dueAt: quickDate || null, allDay: true, priority: quickPriority })
      } else {
        await api.calendar.createReminder({
          calendarId: target,
          title,
          dueAt: quickDate ? new Date(`${quickDate}T09:00:00`).toISOString() : null,
          priority: quickPriority
        })
      }
      setQuickTitle('')
      setQuickPriority(0)
      // 无截止时间的条目在「今天/本周」里看不到，自动切到「全部」避免"点了没反应"
      if ((filter === 'today' || filter === 'week') && !quickDate) {
        setFilter('all')
        setNotice('已添加到「全部」：该条目没有截止时间')
      } else {
        setNotice('已添加')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const toggleRow = async (row: Row): Promise<void> => {
    setBusy(row.key)
    setError(null)
    try {
      if (row.kind === 'task' && row.task) {
        await tasksApi.complete(row.task.id, row.task.status !== 'done')
      } else if (row.reminder) {
        await api.calendar.setReminderCompleted(
          row.reminder.calendarId,
          row.reminder.uid,
          !row.reminder.completed
        )
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const deleteRow = async (row: Row): Promise<void> => {
    setBusy(row.key)
    setError(null)
    try {
      if (row.kind === 'task' && row.task) await tasksApi.delete(row.task.id)
      else if (row.reminder)
        await api.calendar.deleteReminder(row.reminder.calendarId, row.reminder.uid)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const convertRow = async (row: Row): Promise<void> => {
    if (!row.task) return
    setBusy(row.key)
    setError(null)
    try {
      await tasksApi.convertToEvent({ taskId: row.task.id })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="reminders-view">
      <header className="graph-header">
        <div>
          <h1>提醒</h1>
          <p className="graph-subtitle">
            {loading
              ? '加载中…'
              : `${rows.filter((row) => !row.done).length} 条待完成 · 本地任务 ${
                  counts.all
                } 条 · 云提醒 ${reminderCalendars.length} 个列表`}
          </p>
        </div>
        <div className="graph-actions">
          <div className="tasks-filter-bar">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                className={`tasks-filter ${filter === item.key ? 'active' : ''}`}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                {item.key !== 'done' && counts[item.key] > 0 ? ` ${counts[item.key]}` : ''}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="reminders-body">
        <div className="reminder-add">
          <input
            value={quickTitle}
            placeholder="添加一条待办，回车保存"
            onChange={(event) => setQuickTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addItem()
            }}
          />
          <input
            type="date"
            value={quickDate}
            onChange={(event) => setQuickDate(event.target.value)}
          />
          <select
            value={quickPriority}
            onChange={(event) => setQuickPriority(Number(event.target.value) as TaskPriority)}
          >
            <option value={0}>无优先级</option>
            <option value={1}>低</option>
            <option value={2}>中</option>
            <option value={3}>高</option>
          </select>
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="local">本地任务</option>
            {reminderCalendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                ☁️ {calendar.displayName}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={busy === 'add'} onClick={() => void addItem()}>
            添加
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {notice && !error && <div className="settings-message">{notice}</div>}

        {!loading && rows.length === 0 && (
          <p className="reminders-empty">
            {filter === 'done' ? '还没有完成的条目。' : '当前没有待办，添加一条试试。'}
          </p>
        )}

        <ul className="reminders-list">
          {rows.map((row) => {
            const overdue =
              !row.done && row.dueAt && row.dueAt.slice(0, 10) < new Date().toISOString().slice(0, 10)
            return (
              <li key={row.key} className="reminder-item">
                <input
                  type="checkbox"
                  checked={row.done}
                  disabled={busy === row.key}
                  onChange={() => void toggleRow(row)}
                  aria-label={row.title}
                />
                <div className="reminder-main">
                  <span className={`reminder-title ${row.done ? 'done' : ''}`}>
                    {row.title}
                    {row.priority > 0 && (
                      <span className={`reminder-priority p${row.priority}`}>
                        {PRIORITY_LABEL[row.priority]}
                      </span>
                    )}
                  </span>
                  <div className="reminder-meta">
                    <span className={`reminder-cal ${overdue ? 'overdue' : ''}`}>
                      {row.dueAt
                        ? `${overdue ? '已逾期 · ' : ''}${new Date(row.dueAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}`
                        : '无截止时间'}
                    </span>
                    <span className="reminder-list-name">
                      {row.kind === 'task' ? '本地任务' : row.calendarName}
                    </span>
                  </div>
                  {row.notes && <p className="reminder-notes">{row.notes}</p>}
                </div>
                <div className="reminder-actions">
                  {row.kind === 'task' && row.task && (
                    <>
                      <button className="btn-ghost" onClick={() => setEditing({ task: row.task! })}>
                        编辑
                      </button>
                      {!row.task.eventId && (
                        <button
                          className="btn-ghost"
                          disabled={busy === row.key}
                          onClick={() => void convertRow(row)}
                        >
                          转日程
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="btn-ghost danger"
                    disabled={busy === row.key}
                    onClick={() => void deleteRow(row)}
                  >
                    删除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {editing && (
        <TaskEditor
          task={editing.task}
          notes={notes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}
