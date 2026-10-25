import type { TaskPriority } from '../../../../shared/tasks'
import type { ToolServices, ToolExecution } from '../types'
import { normalizeDateTime } from '../../../domain'
import { str } from '../args'
import { isAllDayStamp } from '../../../calendar'

export function execCreateTask(
  input: Record<string, unknown>,
  services: ToolServices
): ToolExecution {
  const title = str(input.title).trim()
  if (!title) return { output: '缺少标题', summary: '创建任务失败', isError: true }
  const dueAt = input.due_at ? normalizeDateTime(input.due_at) : null
  const priority = (
    typeof input.priority === 'number' ? Math.min(3, Math.max(0, Math.round(input.priority))) : 0
  ) as TaskPriority
  const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : []
  const task = services.tasks.create({ title, dueAt, priority, tags, notes: str(input.notes) || undefined })
  return {
    output: JSON.stringify({ ok: true, task_id: task.id, title: task.title, due_at: task.dueAt }),
    summary: `已创建任务：${task.title}`,
    isError: false
  }
}

export function execCompleteTask(
  input: Record<string, unknown>,
  services: ToolServices
): ToolExecution {
  const taskId = str(input.task_id)
  if (!taskId) return { output: '缺少 task_id', summary: '完成任务失败', isError: true }
  const task = services.tasks.complete(taskId, true)
  return {
    output: JSON.stringify({ ok: true, task_id: task.id }),
    summary: `已完成任务：${task.title}`,
    isError: false
  }
}

export function execListTasks(
  input: Record<string, unknown>,
  services: ToolServices
): ToolExecution {
  const filter = (['today', 'week', 'all', 'done'] as const).includes(str(input.filter) as never)
    ? (str(input.filter) as 'today' | 'week' | 'all' | 'done')
    : 'all'
  const tasks = services.tasks.list(filter)
  const lines = tasks.map(
    (t) =>
      `${t.id} | ${t.status === 'done' ? '[已完成]' : '[ ]'} ${t.title}${t.dueAt ? ` (截止 ${t.dueAt.slice(0, 10)})` : ''}`
  )
  return {
    output: tasks.length > 0 ? lines.join('\n') : '没有任务',
    summary: `查询到 ${tasks.length} 个任务`,
    isError: false
  }
}

export async function execConvertTask(
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  const taskId = str(input.task_id)
  if (!taskId) return { output: '缺少 task_id', summary: '转日程失败', isError: true }
  const { task, eventId } = await services.tasks.convertToEvent({ taskId })
  return {
    output: JSON.stringify({ ok: true, task_id: task.id, event_id: eventId }),
    summary: `已将任务「${task.title}」转为日程`,
    isError: false
  }
}
