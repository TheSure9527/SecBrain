import type {
  CreateNoteInput,
  NoteDoc,
  NoteMeta,
  NoteSearchHit,
  SaveAttachmentResult,
  UpdateNoteInput,
  VaultChange
} from '../../shared/ipc'

export type {
  CalendarAccountStatus,
  CalendarEvent,
  CalendarMeta,
  CalendarSettings,
  ConflictCheckInput,
  ConflictCheckResult,
  CreateEventInput,
  TimeSlot,
  UpdateEventInput
} from '../../shared/calendar'
export type { TreeNode, TrashEntry } from '../../shared/vault'
export type {
  BacklinkInfo,
  GraphData,
  GraphEdge,
  GraphNode,
  UnlinkedMention
} from '../../shared/links'
export type { DailyStat } from '../../shared/daily'
export type { ReminderItem } from '../../shared/calendar'
export type { QueryResult } from '../../shared/query'
export type { SemanticHit, SemanticStatus } from '../../shared/semantic'
export type { DocumentStatus } from '../../shared/docs'
export type { ChannelStatusView } from '../../shared/channel'
export type {
  ConvertTaskInput,
  CreateTaskInput,
  Task,
  TaskFilter,
  TaskPriority,
  UpdateTaskInput
} from '../../shared/tasks'
export { AI_PRESETS, CLAUDE_MODELS } from '../../shared/ai'
export type {
  AiConfigView,
  AiPreset,
  AiProviderConfig,
  AiProviderId,
  ButlerChatInput,
  ButlerMessage,
  ButlerReply,
  ToolCallRecord
} from '../../shared/ai'
export type {
  NoteDoc,
  NoteMeta,
  NoteSearchHit,
  VaultChange
} from '../../shared/ipc'

/** 渲染层访问主进程能力的唯一入口 */
export const api = window.secbrain

/** 日历能力命名空间 */
export const calendarApi = api.calendar

/** 任务能力命名空间 */
export const tasksApi = api.tasks

/** 链接能力命名空间 */
export const linksApi = api.links

/** 日记能力命名空间 */
export const dailyApi = api.daily

/** 查询能力命名空间 */
export const queryApi = api.query

/** 语义检索能力命名空间 */
export const semanticApi = api.semantic

/** 材料索引能力命名空间 */
export const docsApi = api.docs

/** 渠道能力命名空间 */
export const channelApi = api.channel

export type { CreateNoteInput, SaveAttachmentResult, UpdateNoteInput }
