/**
 * 日历模块的共享类型（主进程 / preload / 渲染层共用）。
 */

export interface CalendarMeta {
  id: string
  url: string
  displayName: string
  color: string
  source: 'caldav' | 'local'
  /** 服务器声明的分量类型（VEVENT/VTODO…）；空数组按 VEVENT 处理 */
  components: string[]
}

/** 该日历能否存放日程（iCloud「提醒」列表是 VTODO，不能建事件） */
export function supportsEvents(calendar: CalendarMeta): boolean {
  return calendar.components.length === 0 || calendar.components.includes('VEVENT')
}

/** 存储层的事件模型。全天事件 startAt/endAt 为 'YYYY-MM-DD'，定时事件为 ISO UTC。 */
export interface CalendarEvent {
  /** 稳定标识：`${calendarId}::${uid}`；重复实例为 `${calendarId}::${uid}::${occurrenceStart}` */
  id: string
  uid: string
  calendarId: string
  title: string
  description: string
  location: string
  startAt: string
  endAt: string
  allDay: boolean
  rrule: string | null
  reminderMinutes: number | null
  color: string
  /** 是否为重复事件的单个实例 */
  isOccurrence: boolean
}

export interface CreateEventInput {
  calendarId?: string
  title: string
  description?: string
  location?: string
  /** 全天事件：'YYYY-MM-DD'；定时事件：ISO UTC */
  startAt: string
  endAt: string
  allDay: boolean
  rrule?: string | null
  reminderMinutes?: number | null
}

export interface UpdateEventInput {
  id: string
  title?: string
  description?: string
  location?: string
  startAt?: string
  endAt?: string
  allDay?: boolean
  rrule?: string | null
  reminderMinutes?: number | null
}

export interface TimeSlot {
  startAt: string
  endAt: string
}

export interface ConflictCheckInput {
  startAt: string
  endAt: string
  allDay: boolean
  /** 排除自身（编辑时） */
  excludeEventId?: string
}

export interface ConflictCheckResult {
  conflicts: CalendarEvent[]
  suggestions: TimeSlot[]
}

export interface CalDavAccountInput {
  serverUrl: string
  username: string
  password: string
}

export type CalendarSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface CalendarAccountStatus {
  status: CalendarSyncStatus
  username: string | null
  serverUrl: string | null
  calendarCount: number
  lastSyncAt: string | null
  error: string | null
}

export interface CalendarSettings {
  defaultReminderMinutes: number
  bufferMinutes: number
  workStartHour: number
  workEndHour: number
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  defaultReminderMinutes: 15,
  bufferMinutes: 15,
  workStartHour: 9,
  workEndHour: 18
}

export interface CalendarApi {
  listCalendars(): Promise<CalendarMeta[]>
  getEvents(range: { start: string; end: string }): Promise<CalendarEvent[]>
  createEvent(input: CreateEventInput): Promise<CalendarEvent>
  updateEvent(input: UpdateEventInput): Promise<CalendarEvent>
  deleteEvent(id: string): Promise<void>
  checkConflicts(input: ConflictCheckInput): Promise<ConflictCheckResult>
  getAccountStatus(): Promise<CalendarAccountStatus>
  connectAccount(input: CalDavAccountInput): Promise<CalendarAccountStatus>
  disconnectAccount(): Promise<CalendarAccountStatus>
  syncNow(): Promise<CalendarAccountStatus>
  getSettings(): Promise<CalendarSettings>
  saveSettings(settings: CalendarSettings): Promise<CalendarSettings>
  /** 提醒事项（iCloud 提醒列表） */
  listReminders(includeCompleted?: boolean): Promise<ReminderItem[]>
  setReminderCompleted(
    calendarId: string,
    uid: string,
    completed: boolean
  ): Promise<ReminderItem[]>
  /** 可写入的云提醒列表 */
  listReminderCalendars(): Promise<CalendarMeta[]>
  createReminder(input: CreateReminderInput): Promise<ReminderItem[]>
  deleteReminder(calendarId: string, uid: string): Promise<ReminderItem[]>
}

export interface CreateReminderInput {
  calendarId: string
  title: string
  notes?: string
  dueAt?: string | null
  priority?: number
}


/** 提醒事项（iCloud 提醒列表的 VTODO） */
export interface ReminderItem {
  calendarId: string
  calendarName: string
  uid: string
  title: string
  notes: string
  dueAt: string | null
  completed: boolean
  completedAt: string | null
  priority: number
}
