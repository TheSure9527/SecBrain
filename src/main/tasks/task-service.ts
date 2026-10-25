import type {
  ConvertTaskInput,
  CreateTaskInput,
  Task,
  TaskFilter,
  UpdateTaskInput
} from '../../shared/tasks'
import type { TaskStore } from './task-store'
import type { CalendarService } from '../calendar'
import { isAllDayStamp } from '../calendar'

/**
 * 任务服务：编排 TaskStore 与日历能力（转日程）。
 */
export class TaskService {
  constructor(
    private readonly store: TaskStore,
    private readonly calendar: CalendarService
  ) {}

  list(filter: TaskFilter): Task[] {
    return this.store.list(filter)
  }

  counts(): Record<TaskFilter, number> {
    return this.store.counts()
  }

  create(input: CreateTaskInput): Task {
    return this.store.create(input)
  }

  update(input: UpdateTaskInput): Task {
    return this.store.update(input)
  }

  complete(id: string, done: boolean): Task {
    return this.store.setStatus(id, done)
  }

  delete(id: string): void {
    this.store.delete(id)
  }

  /** 任务转为日历事件（双向关联） */
  async convertToEvent(input: ConvertTaskInput): Promise<{ task: Task; eventId: string }> {
    const task = this.store.getById(input.taskId)
    if (!task) throw new Error(`任务不存在: ${input.taskId}`)
    if (task.eventId) return { task, eventId: task.eventId }

    // 目标日历：指定 > 第一个 iCloud 日历 > 本地日历
    const calendars = this.calendar.listCalendars()
    const calendarId =
      input.calendarId ??
      calendars.find((c) => c.source === 'caldav')?.id ??
      calendars.find((c) => c.source === 'local')?.id ??
      'local'

    // 事件时间：全天任务 → 全天事件；带时间 → 原时间；否则默认小时的定时事件
    const today = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const dateStamp = (d: Date): string =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    let startAt: string
    let endAt: string
    let allDay: boolean

    if (task.allDay || (task.dueAt !== null && isAllDayStamp(task.dueAt))) {
      const stamp = task.dueAt?.slice(0, 10) ?? dateStamp(today)
      allDay = true
      startAt = stamp
      endAt = stamp
    } else if (task.dueAt !== null) {
      allDay = false
      startAt = task.dueAt
      const end = new Date(new Date(task.dueAt).getTime() + 60 * 60 * 1000)
      endAt = end.toISOString()
    } else {
      allDay = false
      const hour = input.defaultHour ?? 9
      const start = new Date(today)
      start.setHours(hour, 0, 0, 0)
      if (start.getTime() < today.getTime()) start.setDate(start.getDate() + 1)
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      startAt = start.toISOString()
      endAt = end.toISOString()
    }

    const event = await this.calendar.createEvent({
      calendarId,
      title: task.title,
      description: task.notes,
      startAt,
      endAt,
      allDay
    })
    this.store.setEventLink(task.id, event.id)
    return { task: this.store.getById(task.id)!, eventId: event.id }
  }

  /** 只依赖最小字段，便于日历域通过端口调用 */
  notifyDue(task: { title: string; dueAt: string | null; allDay?: boolean }): void {
    const due =
      task.allDay || !task.dueAt || task.dueAt.length === 10
        ? '今天到期'
        : `截止 ${new Date(task.dueAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
          })}`
    this.calendar.notify(`任务到期：${task.title}`, due)
  }
}
