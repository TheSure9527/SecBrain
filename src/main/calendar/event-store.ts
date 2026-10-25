import type { DatabaseSync } from 'node:sqlite'
import { RRule } from 'rrule'
import type {
  CalendarEvent,
  CalendarMeta,
  CreateEventInput,
  UpdateEventInput
} from '../../shared/calendar'
import { cryptoRandomId, isAllDayStamp } from './ical'

export const LOCAL_CALENDAR_ID = 'local'

export interface StoredEvent {
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
  reminderFired: boolean
  source: 'caldav' | 'local'
  url: string | null
  etag: string | null
  createdAt: string
  updatedAt: string
}

interface EventRow {
  uid: string
  calendar_id: string
  title: string
  description: string
  location: string
  start_at: string
  end_at: string
  all_day: number
  rrule: string | null
  reminder_minutes: number | null
  reminder_fired: number
  source: string
  url: string | null
  etag: string | null
  created_at: string
  updated_at: string
  color?: string
}

export function eventIdOf(calendarId: string, uid: string, occurrenceStart?: string): string {
  return occurrenceStart
    ? `${calendarId}::${uid}::${occurrenceStart}`
    : `${calendarId}::${uid}`
}

/** 事件存储：calendars / events 两表的读写，重复事件在查询时展开。 */
export class EventStore {
  constructor(private readonly db: DatabaseSync) {}

  // ---------- calendars ----------

  upsertCalendar(cal: {
    id: string
    url: string
    displayName: string
    color: string
    source: 'caldav' | 'local'
    ctag?: string | null
    /** 服务器声明的分量类型（缺省 VEVENT） */
    components?: string[]
  }): void {
    this.db
      .prepare(
        `INSERT INTO calendars (id, url, display_name, color, source, ctag, components, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           url = excluded.url,
           display_name = excluded.display_name,
           color = excluded.color,
           ctag = excluded.ctag,
           components = excluded.components,
           synced_at = excluded.synced_at`
      )
      .run(
        cal.id,
        cal.url,
        cal.displayName,
        cal.color,
        cal.source,
        cal.ctag ?? null,
        JSON.stringify(cal.components ?? ['VEVENT']),
        new Date().toISOString()
      )
  }

  ensureLocalCalendar(): CalendarMeta {
    this.upsertCalendar({
      id: LOCAL_CALENDAR_ID,
      url: 'local://calendar',
      displayName: '本地日历',
      color: '#8a8b91',
      source: 'local'
    })
    return this.getCalendar(LOCAL_CALENDAR_ID)!
  }

  removeCalendar(id: string): void {
    this.db.prepare('DELETE FROM calendars WHERE id = ?').run(id)
  }

  getCalendar(id: string): CalendarMeta | null {
    const row = this.db
      .prepare('SELECT id, url, display_name, color, source, components FROM calendars WHERE id = ?')
      .get(id) as
      | {
          id: string
          url: string
          display_name: string
          color: string
          source: string
          components: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      url: row.url,
      displayName: row.display_name,
      color: row.color,
      source: row.source === 'local' ? 'local' : 'caldav',
      components: parseComponents(row.components)
    }
  }

  listCalendars(): CalendarMeta[] {
    const rows = this.db
      .prepare(
        'SELECT id, url, display_name, color, source, components FROM calendars ORDER BY source, display_name'
      )
      .all() as Array<{
      id: string
      url: string
      display_name: string
      color: string
      source: string
      components: string
    }>
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      displayName: r.display_name,
      color: r.color,
      source: r.source === 'local' ? 'local' : 'caldav',
      components: parseComponents(r.components)
    }))
  }

  // ---------- reminders（VTODO） ----------

  upsertReminder(item: {
    calendarId: string
    uid: string
    title: string
    notes: string
    dueAt: string | null
    priority: number
    completed: boolean
    completedAt: string | null
    url?: string | null
    etag?: string | null
  }): void {
    this.db
      .prepare(
        `INSERT INTO reminders
           (calendar_id, uid, title, notes, due_at, priority, completed, completed_at, url, etag, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(calendar_id, uid) DO UPDATE SET
           title = excluded.title,
           notes = excluded.notes,
           due_at = excluded.due_at,
           priority = excluded.priority,
           completed = excluded.completed,
           completed_at = excluded.completed_at,
           url = COALESCE(excluded.url, reminders.url),
           etag = COALESCE(excluded.etag, reminders.etag),
           updated_at = excluded.updated_at`
      )
      .run(
        item.calendarId,
        item.uid,
        item.title,
        item.notes,
        item.dueAt,
        item.priority,
        item.completed ? 1 : 0,
        item.completedAt,
        item.url ?? null,
        item.etag ?? null,
        new Date().toISOString()
      )
  }

  listReminders(options: { includeCompleted?: boolean; calendarId?: string } = {}): Array<{
    calendarId: string
    calendarName: string
    uid: string
    title: string
    notes: string
    dueAt: string | null
    completed: boolean
    completedAt: string | null
    priority: number
  }> {
    const where: string[] = []
    const params: Array<string | number> = []
    if (!options.includeCompleted) where.push('r.completed = 0')
    if (options.calendarId) {
      where.push('r.calendar_id = ?')
      params.push(options.calendarId)
    }
    const rows = this.db
      .prepare(
        `SELECT r.calendar_id, r.uid, r.title, r.notes, r.due_at, r.priority,
                r.completed, r.completed_at, c.display_name
           FROM reminders r
           LEFT JOIN calendars c ON c.id = r.calendar_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY r.completed ASC, r.due_at IS NULL, r.due_at ASC, r.priority DESC`
      )
      .all(...params) as Array<{
      calendar_id: string
      uid: string
      title: string
      notes: string
      due_at: string | null
      priority: number
      completed: number
      completed_at: string | null
      display_name: string | null
    }>
    return rows.map((row) => ({
      calendarId: row.calendar_id,
      calendarName: row.display_name ?? '提醒',
      uid: row.uid,
      title: row.title,
      notes: row.notes,
      dueAt: row.due_at,
      completed: Boolean(row.completed),
      completedAt: row.completed_at,
      priority: row.priority
    }))
  }

  getReminder(calendarId: string, uid: string): {
    calendarId: string
    uid: string
    title: string
    notes: string
    dueAt: string | null
    priority: number
    completed: boolean
    completedAt: string | null
    url: string | null
    etag: string | null
  } | null {
    const row = this.db
      .prepare(
        `SELECT calendar_id, uid, title, notes, due_at, priority, completed, completed_at, url, etag
           FROM reminders WHERE calendar_id = ? AND uid = ?`
      )
      .get(calendarId, uid) as
      | {
          calendar_id: string
          uid: string
          title: string
          notes: string
          due_at: string | null
          priority: number
          completed: number
          completed_at: string | null
          url: string | null
          etag: string | null
        }
      | undefined
    if (!row) return null
    return {
      calendarId: row.calendar_id,
      uid: row.uid,
      title: row.title,
      notes: row.notes,
      dueAt: row.due_at,
      priority: row.priority,
      completed: Boolean(row.completed),
      completedAt: row.completed_at,
      url: row.url,
      etag: row.etag
    }
  }

  setReminderCompleted(
    calendarId: string,
    uid: string,
    completed: boolean,
    etag?: string
  ): void {
    this.db
      .prepare(
        `UPDATE reminders
            SET completed = ?, completed_at = ?, etag = COALESCE(?, etag), updated_at = ?
          WHERE calendar_id = ? AND uid = ?`
      )
      .run(
        completed ? 1 : 0,
        completed ? new Date().toISOString() : null,
        etag ?? null,
        new Date().toISOString(),
        calendarId,
        uid
      )
  }

  removeReminder(calendarId: string, uid: string): void {
    this.db.prepare('DELETE FROM reminders WHERE calendar_id = ? AND uid = ?').run(calendarId, uid)
  }

  removeRemindersNotIn(calendarId: string, keepUids: string[]): number {
    const existing = this.db
      .prepare('SELECT uid FROM reminders WHERE calendar_id = ?')
      .all(calendarId) as Array<{ uid: string }>
    const keep = new Set(keepUids)
    let removed = 0
    for (const row of existing) {
      if (keep.has(row.uid)) continue
      this.db.prepare('DELETE FROM reminders WHERE calendar_id = ? AND uid = ?').run(calendarId, row.uid)
      removed += 1
    }
    return removed
  }

  // ---------- meta ----------

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  }

  // ---------- events ----------

  upsertEvent(event: StoredEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (
           uid, calendar_id, title, description, location,
           start_at, end_at, all_day, rrule, reminder_minutes, reminder_fired,
           source, url, etag, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(calendar_id, uid) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           location = excluded.location,
           start_at = excluded.start_at,
           end_at = excluded.end_at,
           all_day = excluded.all_day,
           rrule = excluded.rrule,
           reminder_minutes = excluded.reminder_minutes,
           reminder_fired = 0,
           url = excluded.url,
           etag = excluded.etag,
           updated_at = excluded.updated_at`
      )
      .run(
        event.uid,
        event.calendarId,
        event.title,
        event.description,
        event.location,
        event.startAt,
        event.endAt,
        event.allDay ? 1 : 0,
        event.rrule,
        event.reminderMinutes,
        event.reminderFired ? 1 : 0,
        event.source,
        event.url,
        event.etag,
        event.createdAt,
        event.updatedAt
      )
  }

  removeEvent(calendarId: string, uid: string): void {
    this.db.prepare('DELETE FROM events WHERE calendar_id = ? AND uid = ?').run(calendarId, uid)
  }

  private rowToStored(row: EventRow): StoredEvent {
    return {
      uid: row.uid,
      calendarId: row.calendar_id,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      allDay: row.all_day === 1,
      rrule: row.rrule,
      reminderMinutes: row.reminder_minutes,
      reminderFired: row.reminder_fired === 1,
      source: row.source === 'local' ? 'local' : 'caldav',
      url: row.url,
      etag: row.etag,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private toCalendarEvent(row: EventRow, occurrenceStart?: string): CalendarEvent {
    const base: CalendarEvent = {
      id: eventIdOf(row.calendar_id, row.uid, occurrenceStart),
      uid: row.uid,
      calendarId: row.calendar_id,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      allDay: row.all_day === 1,
      rrule: row.rrule,
      reminderMinutes: row.reminder_minutes,
      color: row.color ?? '#7c6cf0',
      isOccurrence: !!occurrenceStart
    }
    if (!occurrenceStart) return base
    // 重复实例：平移时间到本次发生
    const duration = this.durationMs(row)
    const start = this.occurrenceToStamp(occurrenceStart, row.all_day === 1)
    const end = new Date(
      (isAllDayStamp(start) ? new Date(`${start}T00:00:00`).getTime() : new Date(start).getTime()) + duration
    )
    base.startAt = start
    base.endAt = row.all_day ? this.toDateStamp(end) : end.toISOString()
    return base
  }

  private durationMs(row: EventRow): number {
    const start = isAllDayStamp(row.start_at)
      ? new Date(`${row.start_at}T00:00:00`).getTime()
      : new Date(row.start_at).getTime()
    const end = isAllDayStamp(row.end_at)
      ? new Date(`${row.end_at}T23:59:59.999`).getTime()
      : new Date(row.end_at).getTime()
    return Math.max(0, end - start)
  }

  private occurrenceToStamp(occurrenceStart: string, allDay: boolean): string {
    // occurrenceStart 以 ISO（全天为日期）传入；全天事件仅保留日期部分
    return allDay ? occurrenceStart.slice(0, 10) : occurrenceStart
  }

  private toDateStamp(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDay).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  /** 全量事件（含日历颜色），供范围过滤前取数 */
  private allEventRows(): EventRow[] {
    return this.db
      .prepare(
        `SELECT e.*, c.color AS color FROM events e
         JOIN calendars c ON c.id = e.calendar_id
         ORDER BY e.start_at`
      )
      .all() as unknown as EventRow[]
  }

  /** 查询范围内的全部事件（重复事件已展开为实例） */
  eventsInRange(rangeStart: string, rangeEnd: string): CalendarEvent[] {
    const from = new Date(isAllDayStamp(rangeStart) ? `${rangeStart}T00:00:00` : rangeStart)
    const to = new Date(isAllDayStamp(rangeEnd) ? `${rangeEnd}T23:59:59.999` : rangeEnd)
    const out: CalendarEvent[] = []

    for (const row of this.allEventRows()) {
      if (row.rrule) {
        for (const occurrence of this.expandOccurrences(row, from, to)) {
          const event = this.toCalendarEvent(row, occurrence)
          const start = isAllDayStamp(event.startAt)
            ? new Date(`${event.startAt}T00:00:00`)
            : new Date(event.startAt)
          const end = isAllDayStamp(event.endAt)
            ? new Date(`${event.endAt}T23:59:59.999`)
            : new Date(event.endAt)
          if (start <= to && end >= from) out.push(event)
        }
      } else {
        const start = isAllDayStamp(row.start_at)
          ? new Date(`${row.start_at}T00:00:00`)
          : new Date(row.start_at)
        const end = isAllDayStamp(row.end_at)
          ? new Date(`${row.end_at}T23:59:59.999`)
          : new Date(row.end_at)
        if (start <= to && end >= from) {
          out.push(this.toCalendarEvent(row))
        }
      }
    }

    out.sort((a, b) => {
      const at = isAllDayStamp(a.startAt) ? `${a.startAt}T00:00:00` : a.startAt
      const bt = isAllDayStamp(b.startAt) ? `${b.startAt}T00:00:00` : b.startAt
      return at.localeCompare(bt)
    })
    return out
  }

  private expandOccurrences(row: EventRow, from: Date, to: Date): string[] {
    try {
      const dtstart = isAllDayStamp(row.start_at)
        ? new Date(`${row.start_at}T00:00:00`)
        : new Date(row.start_at)
      // fromString 的 options 不应用 dtstart，须展开后手动构造
      const rule = new RRule({ ...RRule.parseString(row.rrule!), dtstart })
      // 全天事件按本地日期比较，需把窗口放宽一天避免时区边界漏检
      const windowStart = new Date(from.getTime())
      windowStart.setDate(windowStart.getDate() - 1)
      const windowEnd = new Date(to.getTime())
      windowEnd.setDate(windowEnd.getDate() + 1)
      return rule
        .between(windowStart, windowEnd, true)
        .map((date) => (row.all_day === 1 ? this.toDateStamp(date) : date.toISOString()))
    } catch {
      return [row.start_at]
    }
  }

  // ---------- 查询 / 变更 ----------

  /** 某日历的全部存储事件（未展开） */
  listStoredEventsByCalendar(calendarId: string): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE calendar_id = ? ORDER BY start_at')
      .all(calendarId) as unknown as EventRow[]
    return rows.map((row) => this.rowToStored(row))
  }

  /** 按事件 id 取存储行（实例 id 会归并到主事件） */
  getStoredEventById(id: string): StoredEvent | null {
    const { calendarId, uid } = this.parseEventId(id)
    if (!calendarId || !uid) return null
    const row = this.db
      .prepare('SELECT * FROM events WHERE calendar_id = ? AND uid = ?')
      .get(calendarId, uid) as EventRow | undefined
    return row ? this.rowToStored(row) : null
  }

  getEventById(id: string): CalendarEvent | null {
    const stored = this.getStoredEventById(id)
    if (!stored) return null
    const row = this.db
      .prepare(
        `SELECT e.*, c.color AS color FROM events e
         JOIN calendars c ON c.id = e.calendar_id
         WHERE e.calendar_id = ? AND e.uid = ?`
      )
      .get(stored.calendarId, stored.uid) as EventRow | undefined
    return row ? this.toCalendarEvent(row) : null
  }

  private parseEventId(id: string): { calendarId: string | null; uid: string | null } {
    const parts = id.split('::')
    if (parts.length < 2) return { calendarId: null, uid: null }
    return { calendarId: parts[0]!, uid: parts[1]! }
  }

  /** 在指定日历创建事件（默认本地日历；CalDAV 日历则标记为可推送） */
  createEvent(input: CreateEventInput): CalendarEvent {
    this.ensureLocalCalendar()
    const calendar = this.getCalendar(input.calendarId ?? LOCAL_CALENDAR_ID)
    if (!calendar) throw new Error(`日历不存在: ${input.calendarId}`)
    const now = new Date().toISOString()
    const uid = cryptoRandomId()
    this.upsertEvent({
      uid,
      calendarId: calendar.id,
      title: input.title,
      description: input.description ?? '',
      location: input.location ?? '',
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay,
      rrule: input.rrule ?? null,
      reminderMinutes: input.reminderMinutes ?? null,
      reminderFired: false,
      source: calendar.source,
      url: null,
      etag: null,
      createdAt: now,
      updatedAt: now
    })
    return this.getEventById(eventIdOf(calendar.id, uid))!
  }

  updateEvent(input: UpdateEventInput): CalendarEvent {
    const stored = this.getStoredEventById(input.id)
    if (!stored) throw new Error(`事件不存在: ${input.id}`)
    this.upsertEvent({
      ...stored,
      title: input.title ?? stored.title,
      description: input.description ?? stored.description,
      location: input.location ?? stored.location,
      startAt: input.startAt ?? stored.startAt,
      endAt: input.endAt ?? stored.endAt,
      allDay: input.allDay ?? stored.allDay,
      rrule: input.rrule !== undefined ? input.rrule : stored.rrule,
      reminderMinutes:
        input.reminderMinutes !== undefined ? input.reminderMinutes : stored.reminderMinutes,
      reminderFired: false,
      updatedAt: new Date().toISOString()
    })
    return this.getEventById(eventIdOf(stored.calendarId, stored.uid))!
  }

  deleteEvent(id: string): StoredEvent | null {
    const stored = this.getStoredEventById(id)
    if (!stored) return null
    this.removeEvent(stored.calendarId, stored.uid)
    return stored
  }

  // ---------- 提醒 ----------

  /**
   * 到期待触发提醒的事件（含重复实例）。
   * 提醒最早可提前 24 小时，查询窗口须覆盖最大提前量。
   */
  dueReminderEvents(now: Date, windowSeconds = 120): CalendarEvent[] {
    const MAX_LEAD_MINUTES = 24 * 60 + 60
    const from = new Date(now.getTime() - windowSeconds * 1000)
    // 提醒事件开始于「现在」之后（最多提前 24 小时提醒），窗口须向后覆盖
    const queryFrom = new Date(now.getTime() - windowSeconds * 1000)
    const queryTo = new Date(now.getTime() + MAX_LEAD_MINUTES * 60 * 1000)
    const out: CalendarEvent[] = []
    for (const event of this.eventsInRange(queryFrom.toISOString(), queryTo.toISOString())) {
      if (event.reminderMinutes === null) continue
      const start = isAllDayStamp(event.startAt)
        ? new Date(`${event.startAt}T00:00:00`)
        : new Date(event.startAt)
      const fireAt = start.getTime() - event.reminderMinutes * 60 * 1000
      if (fireAt > from.getTime() && fireAt <= now.getTime()) {
        out.push(event)
      }
    }
    return out
  }

  isReminderFired(key: string): boolean {
    const row = this.db.prepare('SELECT key FROM reminders_fired WHERE key = ?').get(key) as
      | { key: string }
      | undefined
    return !!row
  }

  markReminderFired(key: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reminders_fired (key, fired_at) VALUES (?, ?)`
      )
      .run(key, new Date().toISOString())
  }

  cleanupFiredReminders(before: Date): void {
    this.db
      .prepare('DELETE FROM reminders_fired WHERE fired_at < ?')
      .run(before.toISOString())
  }
}

function parseComponents(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
