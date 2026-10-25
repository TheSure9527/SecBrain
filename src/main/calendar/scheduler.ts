import type { CalendarEvent } from '../../shared/calendar'
import type { Task } from '../../shared/tasks'
import type { EventStore } from './event-store'
import type { DueTask, DueTaskSource } from './ports'

export type RemindHandler = (event: CalendarEvent) => void
export type TaskDueHandler = (task: DueTask) => void

/**
 * 提醒调度器：周期性检查到期的日程提醒与任务，触发系统通知。
 * 去重键落库防重复（日程用事件 id，任务用 task::<id>）。
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: EventStore,
    private readonly onRemind: RemindHandler,
    private readonly tasks?: { store: DueTaskSource; onDue: TaskDueHandler }
  ) {}

  start(intervalMs = 30_000): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), intervalMs)
    // 启动后尽快检查一次
    setTimeout(() => this.tick(), 3_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 供测试/手动触发 */
  tick(now: Date = new Date()): void {
    try {
      for (const event of this.store.dueReminderEvents(now)) {
        if (this.store.isReminderFired(event.id)) continue
        this.store.markReminderFired(event.id)
        this.onRemind(event)
      }
      if (this.tasks) {
        for (const task of this.tasks.store.dueTasks(now)) {
          const key = `task::${task.id}`
          if (this.store.isReminderFired(key)) continue
          this.store.markReminderFired(key)
          this.tasks.onDue(task)
        }
      }
      this.store.cleanupFiredReminders(new Date(now.getTime() - 7 * 24 * 3600 * 1000))
    } catch {
      // 调度失败不影响应用
    }
  }
}
