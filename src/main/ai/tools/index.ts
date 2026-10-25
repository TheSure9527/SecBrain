/**
 * 工具层入口：只做分发，具体执行在 executors/，Schema 在 schema.ts。
 * 新增一个工具 = 在 schema.ts 加定义 + 在对应 executors 加执行函数 + 这里加一个 case。
 */
import type { ToolExecution, ToolServices } from './types'
import { execCreateEvent, execDeleteEvent, execQueryEvents, execUpdateEvent } from './executors/calendar'
import { execCompleteTask, execConvertTask, execCreateTask, execListTasks } from './executors/tasks'
import {
  execDailyBrief,
  execReadNote,
  execRelatedNotes,
  execSearchNotes
} from './executors/notes'

export { TOOL_DEFINITIONS } from './schema'
export type { NoteReference, ToolExecution, ToolServices } from './types'
export { normalizeDateTime } from '../../domain'
export { str, bool } from './args'

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  try {
    switch (name) {
      case 'create_event':
        return await execCreateEvent(input, services)
      case 'update_event':
        return await execUpdateEvent(input, services)
      case 'delete_event':
        return await execDeleteEvent(input, services)
      case 'query_events':
        return execQueryEvents(input, services)
      case 'create_task':
        return execCreateTask(input, services)
      case 'complete_task':
        return execCompleteTask(input, services)
      case 'list_tasks':
        return execListTasks(input, services)
      case 'convert_task_to_event':
        return await execConvertTask(input, services)
      case 'search_notes':
        return await execSearchNotes(input, services)
      case 'read_note':
        return await execReadNote(input, services)
      case 'related_notes':
        return execRelatedNotes(input, services)
      case 'get_daily_brief':
        return execDailyBrief(input, services)
      default:
        return { output: `未知工具: ${name}`, summary: `未知工具 ${name}`, isError: true }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `执行失败: ${message}`, summary: `${name} 失败`, isError: true }
  }
}
