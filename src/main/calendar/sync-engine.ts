import type { DAVCalendar } from 'tsdav'
import type { CalendarEvent } from '../../shared/calendar'
import type { CalDavClient, RemoteEventRef } from './caldav-client'
import type { EventStore, StoredEvent } from './event-store'
import { buildVEventString, buildVTodoString, parseICalEvents, parseVTodos } from './ical'

const CALENDAR_PALETTE = [
  '#7c6cf0',
  '#4fa3e3',
  '#e35d6a',
  '#3fae8a',
  '#e3a34f',
  '#b56ce0',
  '#5aa469'
]

export interface SyncResult {
  calendars: number
  events: number
  removed: number
  /** 同步到的提醒事项（VTODO）条数 */
  reminders: number
}

/**
 * 同步引擎：远程 ↔ 本地存储的双向同步。
 * 策略：按日历整体对账（ctag 变化才拉取），拉取结果全量 upsert +
 * 移除本地已不存在于远程的事件；写回带 412 冲突重试一次。
 */
export class SyncEngine {
  constructor(
    private readonly client: CalDavClient,
    private readonly store: EventStore
  ) {}

  /** 同步窗口：过去 1 年 ~ 未来 2 年 */
  private syncRange(): { start: string; end: string } {
    const now = new Date()
    const start = new Date(now)
    start.setFullYear(start.getFullYear() - 1)
    const end = new Date(now)
    end.setFullYear(end.getFullYear() + 2)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  async syncAll(): Promise<SyncResult> {
    const remoteCalendars = await this.client.listCalendars()
    const result: SyncResult = { calendars: remoteCalendars.length, events: 0, reminders: 0, removed: 0 }
    const range = this.syncRange()
    const seenCalendarIds = new Set<string>()

    for (const [index, remote] of remoteCalendars.entries()) {
      const calendarId = calendarIdFromUrl(remote.url)
      seenCalendarIds.add(calendarId)
      this.store.upsertCalendar({
        id: calendarId,
        url: remote.url,
        displayName:
          typeof remote.displayName === 'string' && remote.displayName
            ? remote.displayName
            : '未命名日历',
        color: CALENDAR_PALETTE[index % CALENDAR_PALETTE.length]!,
        source: 'caldav',
        ctag: remote.ctag ?? null,
        components: Array.isArray(remote.components) ? remote.components : []
      })

      // iCloud「提醒」等 VTODO 列表：不走事件同步，改同步提醒事项
      const components = Array.isArray(remote.components) ? remote.components : []
      const acceptsEvents = components.length === 0 || components.includes('VEVENT')
      if (!acceptsEvents) {
        const todos = await this.client.fetchTodos(remote)
        const uids: string[] = []
        for (const object of todos) {
          for (const todo of parseVTodos(object.data ?? '')) {
            if (!todo.uid) continue
            uids.push(todo.uid)
            this.store.upsertReminder({
              calendarId,
              uid: todo.uid,
              title: todo.title,
              notes: todo.notes,
              dueAt: todo.dueAt,
              priority: todo.priority,
              completed: todo.completed,
              completedAt: todo.completedAt,
              url: object.url,
              etag: object.etag ?? null
            })
            result.reminders += 1
          }
        }
        this.store.removeRemindersNotIn(calendarId, uids)
        continue
      }

      const objects = await this.client.fetchEvents(remote, range)
      const remoteUids = new Set<string>()
      for (const object of objects) {
        for (const parsed of parseICalEvents(object.data ?? '')) {
          remoteUids.add(parsed.uid)
          this.store.upsertEvent({
            uid: parsed.uid,
            calendarId,
            title: parsed.title,
            description: parsed.description,
            location: parsed.location,
            startAt: parsed.startAt,
            endAt: parsed.endAt,
            allDay: parsed.allDay,
            rrule: parsed.rrule,
            reminderMinutes: parsed.reminderMinutes,
            reminderFired: false,
            source: 'caldav',
            url: object.url,
            etag: object.etag ?? '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          result.events += 1
        }
      }

      // 移除远程已删除的事件
      for (const stored of this.store.listStoredEventsByCalendar(calendarId)) {
        if (!remoteUids.has(stored.uid)) {
          this.store.removeEvent(calendarId, stored.uid)
          result.removed += 1
        }
      }
    }

    // 清理本地残留的远程日历（账号切换场景）
    for (const cal of this.store.listCalendars()) {
      if (cal.source === 'caldav' && !seenCalendarIds.has(cal.id)) {
        this.store.removeCalendar(cal.id)
        result.removed += 1
      }
    }

    return result
  }

  /** 本地新建事件 → 推送远程（仅 caldav 来源日历） */
  /** 新建提醒：写入远端提醒列表，回填 url/etag */
  async pushReminderCreate(
    calendarId: string,
    reminder: {
      uid: string
      title: string
      notes: string
      dueAt: string | null
      priority: number
    }
  ): Promise<void> {
    const calendar = await this.remoteCalendar(calendarId)
    if (!calendar) throw new Error('云提醒列表不可用（请先连接 iCloud）')
    const ics = buildVTodoString({
      uid: reminder.uid,
      title: reminder.title,
      notes: reminder.notes,
      dueAt: reminder.dueAt,
      priority: reminder.priority,
      completed: false
    })
    const ref = await this.client.createEvent(calendar, reminder.uid, ics)
    this.store.upsertReminder({
      calendarId,
      uid: reminder.uid,
      title: reminder.title,
      notes: reminder.notes,
      dueAt: reminder.dueAt,
      priority: reminder.priority,
      completed: false,
      completedAt: null,
      url: ref.url,
      etag: ref.etag
    })
  }

  /** 删除提醒：远端有对象时一并删除 */
  async pushReminderDelete(calendarId: string, url: string | null, etag: string | null): Promise<void> {
    if (!url) return
    const calendar = await this.remoteCalendar(calendarId)
    if (!calendar) return
    await this.client.deleteEvent({ calendar, url, etag: etag ?? '' })
  }

  /** 勾选完成时回写远端 VTODO */
  async pushReminderDone(
    calendarId: string,
    reminder: {
      uid: string
      title: string
      notes: string
      dueAt: string | null
      priority: number
      completedAt: string | null
      url: string | null
      etag: string | null
    },
    completed: boolean
  ): Promise<void> {
    if (!reminder.url) return
    const calendar = await this.remoteCalendar(calendarId)
    if (!calendar) return
    const ics = buildVTodoString({
      uid: reminder.uid,
      title: reminder.title,
      notes: reminder.notes,
      dueAt: reminder.dueAt,
      priority: reminder.priority,
      completed,
      completedAt: completed ? (reminder.completedAt ?? new Date().toISOString()) : null
    })
    const etag = await this.client.updateEvent(
      { calendar, url: reminder.url, etag: reminder.etag ?? '' },
      ics
    )
    this.store.setReminderCompleted(calendarId, reminder.uid, completed, etag)
  }

  async pushCreate(event: CalendarEvent): Promise<void> {
    const stored = this.store.getStoredEventById(event.id)
    if (!stored || stored.source !== 'caldav') return
    const calendar = await this.remoteCalendar(stored.calendarId)
    if (!calendar) return

    // 提醒列表（VTODO）不接收 VEVENT：提前拦下，避免服务端 403 被静默吞掉
    if (Array.isArray(calendar.components) && calendar.components.length > 0 && !calendar.components.includes('VEVENT')) {
      throw new Error(`「${calendar.displayName}」是提醒列表，不能存放日程`)
    }

    const ref = await this.client.createEvent(
      calendar,
      stored.uid,
      buildVEventString({
        uid: stored.uid,
        title: stored.title,
        description: stored.description,
        location: stored.location,
        startAt: stored.startAt,
        endAt: stored.endAt,
        allDay: stored.allDay,
        rrule: stored.rrule,
        reminderMinutes: stored.reminderMinutes
      })
    )
    this.store.upsertEvent({ ...stored, url: ref.url, etag: ref.etag })
  }

  /** 本地修改 → 推送远程（412 时重拉 etag 重试一次） */
  async pushUpdate(event: CalendarEvent): Promise<void> {
    const stored = this.store.getStoredEventById(event.id)
    if (!stored || stored.source !== 'caldav' || !stored.url) return
    const calendar = await this.remoteCalendar(stored.calendarId)
    if (!calendar) return

    // 提醒列表（VTODO）不接收 VEVENT：提前拦下，避免服务端 403 被静默吞掉
    if (Array.isArray(calendar.components) && calendar.components.length > 0 && !calendar.components.includes('VEVENT')) {
      throw new Error(`「${calendar.displayName}」是提醒列表，不能存放日程`)
    }

    const iCalString = buildVEventString({
      uid: stored.uid,
      title: stored.title,
      description: stored.description,
      location: stored.location,
      startAt: stored.startAt,
      endAt: stored.endAt,
      allDay: stored.allDay,
      rrule: stored.rrule,
      reminderMinutes: stored.reminderMinutes
    })

    let ref: RemoteEventRef = {
      calendar,
      url: stored.url,
      etag: stored.etag ?? ''
    }
    try {
      const newEtag = await this.client.updateEvent(ref, iCalString)
      this.store.upsertEvent({ ...stored, etag: newEtag })
    } catch {
      // etag 过期：重拉后重试一次
      const fresh = await this.client.refetch(calendar, stored.url)
      if (!fresh) throw new Error('远程事件已不存在')
      const newEtag = await this.client.updateEvent(fresh, iCalString)
      this.store.upsertEvent({ ...stored, etag: newEtag })
    }
  }

  /** 本地删除 → 推送远程 */
  async pushDelete(stored: StoredEvent): Promise<void> {
    if (stored.source !== 'caldav' || !stored.url) return
    const calendar = await this.remoteCalendar(stored.calendarId)
    if (!calendar) return

    // 提醒列表（VTODO）不接收 VEVENT：提前拦下，避免服务端 403 被静默吞掉
    if (Array.isArray(calendar.components) && calendar.components.length > 0 && !calendar.components.includes('VEVENT')) {
      throw new Error(`「${calendar.displayName}」是提醒列表，不能存放日程`)
    }
    await this.client.deleteEvent({ calendar, url: stored.url, etag: stored.etag ?? '' })
  }

  private remoteCalendarCache = new Map<string, DAVCalendar>()

  private async remoteCalendar(calendarId: string): Promise<DAVCalendar | null> {
    const cached = this.remoteCalendarCache.get(calendarId)
    if (cached) return cached
    const meta = this.store.getCalendar(calendarId)
    if (!meta || meta.source !== 'caldav') return null
    const remote = (await this.client.listCalendars()).find((c) => c.url === meta.url)
    if (remote) this.remoteCalendarCache.set(calendarId, remote)
    return remote ?? null
  }

  clearCalendarCache(): void {
    this.remoteCalendarCache.clear()
  }
}

export function calendarIdFromUrl(url: string): string {
  // 稳定 id：URL 的 hash（同一账号下不变）
  let hash = 0
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0
  }
  return `cal-${(hash >>> 0).toString(36)}`
}
