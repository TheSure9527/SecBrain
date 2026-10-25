/**
 * 日历域的出站端口（依赖倒置）。
 * 提醒调度器只需要「到期的任务」，不应反向依赖 tasks 域。
 */

export interface DueTask {
  id: string
  title: string
  dueAt: string | null
}

export interface DueTaskSource {
  dueTasks(now: Date): DueTask[]
}
