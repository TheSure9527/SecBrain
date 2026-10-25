/**
 * 任务模块的共享类型（主进程 / preload / 渲染层共用）。
 */

export type TaskPriority = 0 | 1 | 2 | 3
export type TaskStatus = 'todo' | 'done'

export interface Task {
  id: string
  title: string
  notes: string
  /** 截止：ISO UTC（带时间）、'YYYY-MM-DD'（全天）或 null（无截止） */
  dueAt: string | null
  allDay: boolean
  priority: TaskPriority
  status: TaskStatus
  tags: string[]
  /** 关联笔记的 vault 相对路径 */
  notePath: string | null
  /** 转为日程后关联的日历事件 id */
  eventId: string | null
  createdAt: string
  completedAt: string | null
}

export interface CreateTaskInput {
  title: string
  notes?: string
  dueAt?: string | null
  allDay?: boolean
  priority?: TaskPriority
  tags?: string[]
  notePath?: string | null
}

export interface UpdateTaskInput {
  id: string
  title?: string
  notes?: string
  dueAt?: string | null
  allDay?: boolean
  priority?: TaskPriority
  tags?: string[]
  notePath?: string | null
}

export type TaskFilter = 'today' | 'week' | 'all' | 'done'

export interface ConvertTaskInput {
  taskId: string
  /** 目标日历 id；缺省用第一个 iCloud 日历，否则本地日历 */
  calendarId?: string
  /** 无截止时间的任务转日程时的默认开始时间（默认 09:00） */
  defaultHour?: number
}

export interface TaskApi {
  list(filter: TaskFilter): Promise<Task[]>
  counts(): Promise<Record<TaskFilter, number>>
  create(input: CreateTaskInput): Promise<Task>
  update(input: UpdateTaskInput): Promise<Task>
  complete(id: string, done: boolean): Promise<Task>
  delete(id: string): Promise<void>
  convertToEvent(input: ConvertTaskInput): Promise<{ task: Task; eventId: string }>
}
