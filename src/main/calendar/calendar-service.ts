import { Notification, safeStorage } from 'electron'
import type {
  CalendarAccountStatus,
  CalendarEvent,
  CalendarSettings,
  CalDavAccountInput,
  ConflictCheckInput,
  ConflictCheckResult,
  CreateEventInput,
  UpdateEventInput,
  CalendarMeta,
  ReminderItem
} from '../../shared/calendar'
import { DEFAULT_CALENDAR_SETTINGS } from '../../shared/calendar'
import type { EventStore } from './event-store'
import { CalDavClient } from './caldav-client'
import type { SyncEngine } from './sync-engine'
import { detectConflicts, suggestSlots } from './conflict'
import { cryptoRandomId } from './ical'

const KEY_SERVER = 'caldav.serverUrl'
const KEY_USERNAME = 'caldav.username'
const KEY_PASSWORD_ENC = 'caldav.password.enc'
const KEY_LAST_SYNC = 'caldav.lastSyncAt'
const KEY_SETTINGS = 'calendar.settings'

/**
 * 日历服务：账号（凭证加密存储）、事件 CRUD、冲突检测、
 * 同步与提醒的唯一编排入口。
 */
export class CalendarService {
  private syncEngine: SyncEngine | null = null
  private settings: CalendarSettings = { ...DEFAULT_CALENDAR_SETTINGS }

  /** client 由外部注入并与 SyncEngine 共享，保证读写同一连接 */
  constructor(
    private readonly store: EventStore,
    private readonly client: CalDavClient
  ) {
    this.settings = this.loadSettings()
  }

  attachSyncEngine(engine: SyncEngine): void {
    this.syncEngine = engine
  }

  // ---------- 账号 ----------

  async connectAccount(input: CalDavAccountInput): Promise<CalendarAccountStatus> {
    await this.client.connect(input) // 失败抛错，由 IPC 层转为 error 状态
    this.store.setMeta(KEY_SERVER, input.serverUrl)
    this.store.setMeta(KEY_USERNAME, input.username)
    this.store.setMeta(KEY_PASSWORD_ENC, safeStorage.encryptString(input.password).toString('base64'))

    // 返回同步结果（含失败原因），避免把同步错误显示成"已连接"
    return this.syncNow()
  }

  async disconnectAccount(): Promise<CalendarAccountStatus> {
    this.client.disconnect()
    this.syncEngine?.clearCalendarCache()
    this.store.deleteMeta(KEY_SERVER)
    this.store.deleteMeta(KEY_USERNAME)
    this.store.deleteMeta(KEY_PASSWORD_ENC)
    this.store.deleteMeta(KEY_LAST_SYNC)
    // 清理 caldav 日历及其事件（本地日历保留）
    for (const cal of this.store.listCalendars()) {
      if (cal.source === 'caldav') this.store.removeCalendar(cal.id)
    }
    return this.getAccountStatus()
  }

  getAccountStatus(): CalendarAccountStatus {
    const serverUrl = this.store.getMeta(KEY_SERVER)
    const username = this.store.getMeta(KEY_USERNAME)
    const lastSyncAt = this.store.getMeta(KEY_LAST_SYNC)
    const calendarCount = this.store.listCalendars().filter((c) => c.source === 'caldav').length
    return {
      status: this.client.isConnected() ? 'connected' : 'disconnected',
      username: username ?? null,
      serverUrl: serverUrl ?? null,
      calendarCount,
      lastSyncAt: lastSyncAt ?? null,
      error: null
    }
  }

  /** 应用启动时尝试用已存凭证恢复连接 */
  async restoreAccount(): Promise<CalendarAccountStatus> {
    const serverUrl = this.store.getMeta(KEY_SERVER)
    const username = this.store.getMeta(KEY_USERNAME)
    const passwordEnc = this.store.getMeta(KEY_PASSWORD_ENC)
    if (!serverUrl || !username || !passwordEnc) return this.getAccountStatus()
    try {
      const password = safeStorage.decryptString(Buffer.from(passwordEnc, 'base64'))
      await this.client.connect({ serverUrl, username, password })
      return this.getAccountStatus()
    } catch {
      return this.getAccountStatus()
    }
  }

  async syncNow(): Promise<CalendarAccountStatus> {
    if (!this.client.isConnected() || !this.syncEngine) {
      const status = this.getAccountStatus()
      return { ...status, error: '未连接日历账号' }
    }
    try {
      await this.syncEngine.syncAll()
      this.store.setMeta(KEY_LAST_SYNC, new Date().toISOString())
      return this.getAccountStatus()
    } catch (err) {
      const status = this.getAccountStatus()
      console.error('[sync] failed:', err instanceof Error ? err.message : String(err))
      return { ...status, status: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ---------- 设置 ----------

  getSettings(): CalendarSettings {
    return { ...this.settings }
  }

  saveSettings(settings: CalendarSettings): CalendarSettings {
    this.settings = { ...settings }
    this.store.setMeta(KEY_SETTINGS, JSON.stringify(this.settings))
    return this.getSettings()
  }

  private loadSettings(): CalendarSettings {
    const raw = this.store.getMeta(KEY_SETTINGS)
    if (!raw) return { ...DEFAULT_CALENDAR_SETTINGS }
    try {
      return { ...DEFAULT_CALENDAR_SETTINGS, ...(JSON.parse(raw) as Partial<CalendarSettings>) }
    } catch {
      return { ...DEFAULT_CALENDAR_SETTINGS }
    }
  }

  // ---------- 事件 ----------

  listCalendars() {
    return this.store.listCalendars()
  }

  getEvents(range: { start: string; end: string }): CalendarEvent[] {
    return this.store.eventsInRange(range.start, range.end)
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const target = this.resolveEventCalendar(input.calendarId)
    const event = this.store.createEvent({
      ...input,
      calendarId: target.id,
      reminderMinutes: input.reminderMinutes ?? this.settings.defaultReminderMinutes
    })
    const stored = this.store.getStoredEventById(event.id)
    if (this.client.isConnected() && this.syncEngine && stored?.source === 'caldav') {
      try {
        await this.syncEngine.pushCreate(event)
      } catch (err) {
        // 保留本地事件，但必须让用户知道"没同步上去"
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[calendar] 「${event.title}」推送云端失败:`, message)
        this.notify(
          '日程未同步到云端',
          `「${event.title}」已保存到本机，但推送 iCloud 失败：${message}`
        )
      }
    }
    return this.store.getEventById(event.id) ?? event
  }

  async updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
    const event = this.store.updateEvent(input)
    const stored = this.store.getStoredEventById(event.id)
    if (this.client.isConnected() && this.syncEngine && stored?.source === 'caldav') {
      try {
        await this.syncEngine.pushUpdate(event)
      } catch {
        // 远程推送失败时保留本地修改
      }
    }
    return this.store.getEventById(event.id) ?? event
  }

  async deleteEvent(id: string): Promise<void> {
    const stored = this.store.deleteEvent(id)
    if (stored && this.client.isConnected() && this.syncEngine) {
      try {
        await this.syncEngine.pushDelete(stored)
      } catch {
        // 远程删除失败时保留本地已删除状态
      }
    }
  }

  checkConflicts(input: ConflictCheckInput): ConflictCheckResult {
    // 候选事件前后各取 1 天范围足够覆盖全天事件
    const from = new Date(input.startAt)
    from.setDate(from.getDate() - 1)
    const to = new Date(input.endAt)
    to.setDate(to.getDate() + 2)
    const events = this.store.eventsInRange(from.toISOString(), to.toISOString())
    const conflicts = detectConflicts(events, input)
    const durationMinutes = Math.max(
      15,
      Math.round((new Date(input.endAt).getTime() - new Date(input.startAt).getTime()) / 60000)
    )
    const suggestions = suggestSlots(events, {
      durationMinutes,
      bufferMinutes: this.settings.bufferMinutes,
      workStartHour: this.settings.workStartHour,
      workEndHour: this.settings.workEndHour
    })
    return { conflicts, suggestions }
  }

  notify(title: string, body: string): void {
    if (!Notification.isSupported()) return
    new Notification({ title, body, silent: false }).show()
  }

  notifyReminder(event: CalendarEvent): void {
    const time = event.allDay
      ? '全天'
      : new Date(event.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    this.notify(event.title || '日程提醒', `${time} · ${event.location || '即将开始'}`)
  }

  /**
   * 选一个能放日程的日历：
   * - 指定且支持 VEVENT → 用它
   * - 指定的是提醒列表（VTODO）→ 自动改用默认云端日历
   * - 未指定 → 优先第一个云端日历（这样才会同步到 iCloud），否则本地
   */
  private resolveEventCalendar(calendarId?: string): CalendarMeta {
    const calendars = this.store.listCalendars()
    const eventCalendars = calendars.filter(
      (cal) => cal.components.length === 0 || cal.components.includes('VEVENT')
    )
    if (calendarId) {
      const match = eventCalendars.find((cal) => cal.id === calendarId)
      if (match) return match
    }
    return (
      eventCalendars.find((cal) => cal.source === 'caldav') ??
      eventCalendars.find((cal) => cal.id === 'local') ??
      calendars[0]!
    )
  }

  // ---------- 提醒事项（VTODO） ----------

  listReminders(includeCompleted = false): ReminderItem[] {
    return this.store.listReminders({ includeCompleted })
  }

  /** 可写入的云提醒列表（VTODO 集合） */
  listReminderCalendars(): CalendarMeta[] {
    return this.store
      .listCalendars()
      .filter((cal) => cal.components.includes('VTODO') && cal.source === 'caldav')
  }

  async createReminder(input: {
    calendarId: string
    title: string
    notes?: string
    dueAt?: string | null
    priority?: number
  }): Promise<ReminderItem[]> {
    const calendar = this.store.getCalendar(input.calendarId)
    if (!calendar) throw new Error('提醒列表不存在')
    if (!calendar.components.includes('VTODO')) throw new Error(`「${calendar.displayName}」不是提醒列表`)
    const uid = cryptoRandomId()
    const item = {
      calendarId: input.calendarId,
      uid,
      title: input.title.trim() || '未命名提醒',
      notes: input.notes ?? '',
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? 0
    }
    // 先落本地，再推云端（失败也保留，并在返回值里体现）
    this.store.upsertReminder({ ...item, completed: false, completedAt: null })
    if (this.client.isConnected() && this.syncEngine) {
      try {
        await this.syncEngine.pushReminderCreate(input.calendarId, item)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[calendar] 提醒未同步到 iCloud:', message)
        this.notify('提醒未同步到云端', `「${item.title}」已保存到本机，但推送 iCloud 失败：${message}`)
      }
    }
    return this.listReminders(true)
  }

  async deleteReminder(calendarId: string, uid: string): Promise<ReminderItem[]> {
    const reminder = this.store.getReminder(calendarId, uid)
    this.store.removeReminder(calendarId, uid)
    if (reminder && this.client.isConnected() && this.syncEngine && reminder.url) {
      try {
        await this.syncEngine.pushReminderDelete(calendarId, reminder.url, reminder.etag)
      } catch (err) {
        console.warn('[calendar] 删除远程提醒失败:', err instanceof Error ? err.message : err)
      }
    }
    return this.listReminders(true)
  }

  /** 勾选/取消勾选，云端存在时回写 */
  setReminderCompleted(calendarId: string, uid: string, completed: boolean): ReminderItem[] {
    const reminder = this.store.getReminder(calendarId, uid)
    if (!reminder) throw new Error('提醒事项不存在')
    this.store.setReminderCompleted(calendarId, uid, completed)
    if (this.client.isConnected() && this.syncEngine && reminder.url) {
      void this.syncEngine.pushReminderDone(calendarId, reminder, completed).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[calendar] 提醒状态回写失败:', message)
        this.notify('提醒状态未同步', `「${reminder.title}」的完成状态没有同步到 iCloud：${message}`)
      })
    }
    return this.listReminders(true)
  }

  /** 该日历能否存放日程（iCloud「提醒」是 VTODO 列表，写入后两端都看不到） */
  private assertAcceptsEvents(calendarId: string): void {
    const calendar = this.store.getCalendar(calendarId)
    if (!calendar) throw new Error(`日历不存在：${calendarId}`)
    if (calendar.components.length > 0 && !calendar.components.includes('VEVENT')) {
      throw new Error(
        `「${calendar.displayName}」是提醒列表，不能存放日程。请改选「个人」「工作」等日历。`
      )
    }
  }
}
