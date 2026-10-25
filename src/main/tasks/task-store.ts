import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateTaskInput,
  Task,
  TaskFilter,
  TaskPriority,
  UpdateTaskInput
} from '../../shared/tasks'
import { isAllDayStamp, randomId } from '../domain'

interface TaskRow {
  id: string
  title: string
  notes: string
  due_at: string | null
  all_day: number
  priority: number
  status: string
  tags: string
  note_path: string | null
  event_id: string | null
  created_at: string
  completed_at: string | null
}

function toDateStamp(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    allDay: row.all_day === 1,
    priority: (Math.min(3, Math.max(0, row.priority)) as TaskPriority),
    status: row.status === 'done' ? 'done' : 'todo',
    tags: parseTags(row.tags),
    notePath: row.note_path,
    eventId: row.event_id,
    createdAt: row.created_at,
    completedAt: row.completed_at
  }
}

/** 任务存储：CRUD 与筛选（今天 / 本周 / 全部 / 已完成）。 */
export class TaskStore {
  constructor(private readonly db: DatabaseSync) {}

  private allRows(): TaskRow[] {
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as unknown as TaskRow[]
  }

  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString()
    const id = `task-${randomId()}`
    this.db
      .prepare(
        `INSERT INTO tasks (
           id, title, notes, due_at, all_day, priority, status, tags,
           note_path, event_id, created_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, NULL, ?, NULL)`
      )
      .run(
        id,
        input.title,
        input.notes ?? '',
        input.dueAt ?? null,
        input.allDay ? 1 : 0,
        input.priority ?? 0,
        JSON.stringify(input.tags ?? []),
        input.notePath ?? null,
        now
      )
    return this.getById(id)!
  }

  getById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? rowToTask(row) : null
  }

  update(input: UpdateTaskInput): Task {
    const existing = this.getById(input.id)
    if (!existing) throw new Error(`任务不存在: ${input.id}`)
    this.db
      .prepare(
        `UPDATE tasks SET
           title = ?, notes = ?, due_at = ?, all_day = ?, priority = ?,
           tags = ?, note_path = ?
         WHERE id = ?`
      )
      .run(
        input.title ?? existing.title,
        input.notes ?? existing.notes,
        input.dueAt !== undefined ? input.dueAt : existing.dueAt,
        input.allDay ?? existing.allDay ? 1 : 0,
        input.priority ?? existing.priority,
        JSON.stringify(input.tags ?? existing.tags),
        input.notePath !== undefined ? input.notePath : existing.notePath,
        input.id
      )
    return this.getById(input.id)!
  }

  setStatus(id: string, done: boolean): Task {
    const existing = this.getById(id)
    if (!existing) throw new Error(`任务不存在: ${id}`)
    this.db
      .prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
      .run(done ? 'done' : 'todo', done ? new Date().toISOString() : null, id)
    return this.getById(id)!
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  setEventLink(id: string, eventId: string): void {
    this.db.prepare('UPDATE tasks SET event_id = ? WHERE id = ?').run(eventId, id)
  }

  /** 按筛选条件返回任务（未完成按截止升序 + 创建倒序；已完成按完成倒序） */
  list(filter: TaskFilter): Task[] {
    const rows = this.allRows().map(rowToTask)
    const today = toDateStamp(new Date())
    const weekEnd = ((): string => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return toDateStamp(d)
    })()

    const filtered = rows.filter((task) => {
      if (filter === 'done') return task.status === 'done'
      if (task.status === 'done') return false
      switch (filter) {
        case 'today':
          return task.dueAt !== null && task.dueAt.slice(0, 10) <= today
        case 'week':
          return task.dueAt !== null && task.dueAt.slice(0, 10) <= weekEnd
        case 'all':
        default:
          return true
      }
    })

    return filtered.sort((a, b) => {
      // 无截止的排最后；其余按截止升序；同日按优先级降序
      if (a.dueAt === null && b.dueAt === null) return b.createdAt.localeCompare(a.createdAt)
      if (a.dueAt === null) return 1
      if (b.dueAt === null) return -1
      if (a.dueAt !== b.dueAt) return a.dueAt.localeCompare(b.dueAt)
      if (a.priority !== b.priority) return b.priority - a.priority
      return b.createdAt.localeCompare(a.createdAt)
    })
  }

  counts(): Record<TaskFilter, number> {
    const rows = this.allRows().map(rowToTask)
    const today = toDateStamp(new Date())
    const weekEnd = ((): string => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      return toDateStamp(d)
    })()
    return {
      today: rows.filter(
        (t) => t.status === 'todo' && t.dueAt !== null && t.dueAt.slice(0, 10) <= today
      ).length,
      week: rows.filter(
        (t) => t.status === 'todo' && t.dueAt !== null && t.dueAt.slice(0, 10) <= weekEnd
      ).length,
      all: rows.filter((t) => t.status === 'todo').length,
      done: rows.filter((t) => t.status === 'done').length
    }
  }

  /** 到期待提醒的任务：到点前 windowSeconds 内、未完成、未触发过 */
  dueTasks(now: Date, windowSeconds = 120): Task[] {
    const rows = this.allRows().map(rowToTask)
    const out: Task[] = []
    for (const task of rows) {
      if (task.status !== 'todo' || task.dueAt === null) continue
      const due = task.allDay
        ? new Date(`${task.dueAt.slice(0, 10)}T09:00:00`)
        : new Date(task.dueAt)
      const elapsed = now.getTime() - due.getTime()
      if (elapsed >= 0 && elapsed <= windowSeconds * 1000) {
        out.push(task)
      }
    }
    return out
  }
}

export { isAllDayStamp }
