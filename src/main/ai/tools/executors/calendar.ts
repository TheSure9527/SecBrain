import type { ToolServices, ToolExecution } from '../types'
import { normalizeDateTime } from '../../../domain'
import { str, bool } from '../args'
import { isAllDayStamp } from '../../../calendar'
import type { CalendarService } from '../../../calendar'
import { eventSummaryLine } from '../helpers'


export async function execCreateEvent(
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  const title = str(input.title).trim()
  if (!title) return { output: '缺少标题', summary: '创建事件失败', isError: true }
  const startAt = normalizeDateTime(input.start_at)
  if (!startAt) return { output: '无法解析开始时间', summary: '创建事件失败', isError: true }

  const allDay = bool(input.all_day) || isAllDayStamp(startAt)
  let endAt: string
  if (input.end_at) {
    endAt = normalizeDateTime(input.end_at) ?? startAt
  } else if (allDay) {
    endAt = startAt
  } else {
    endAt = new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString()
  }

  const event = await services.calendar.createEvent({
    title,
    startAt,
    endAt,
    allDay,
    location: str(input.location) || undefined,
    description: str(input.description) || undefined,
    calendarId: str(input.calendar_id) || undefined
  })
  const calendarName =
    services.calendar.listCalendars().find((cal) => cal.id === event.calendarId)?.displayName ??
    event.calendarId
  return {
    output: JSON.stringify({
      ok: true,
      event_id: event.id,
      event: eventSummaryLine(event),
      calendar: calendarName
    }),
    summary: `已创建事件：${event.title}`,
    isError: false
  }
}

export async function execUpdateEvent(
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  const eventId = str(input.event_id)
  if (!eventId) return { output: '缺少 event_id', summary: '修改事件失败', isError: true }
  const patch: Record<string, unknown> = { id: eventId }
  if (input.title !== undefined) patch.title = str(input.title)
  if (input.start_at !== undefined) {
    const startAt = normalizeDateTime(input.start_at)
    if (startAt) patch.startAt = startAt
  }
  if (input.end_at !== undefined) {
    const endAt = normalizeDateTime(input.end_at)
    if (endAt) patch.endAt = endAt
  }
  if (input.location !== undefined) patch.location = str(input.location)
  if (input.description !== undefined) patch.description = str(input.description)

  const event = await services.calendar.updateEvent(
    patch as unknown as Parameters<CalendarService['updateEvent']>[0]
  )
  return {
    output: JSON.stringify({ ok: true, event_id: event.id }),
    summary: `已修改事件：${event.title}`,
    isError: false
  }
}

export async function execDeleteEvent(
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  const eventId = str(input.event_id)
  if (!eventId) return { output: '缺少 event_id', summary: '删除事件失败', isError: true }
  await services.calendar.deleteEvent(eventId)
  return {
    output: JSON.stringify({ ok: true }),
    summary: `已删除事件 ${eventId}`,
    isError: false
  }
}

export function execQueryEvents(
  input: Record<string, unknown>,
  services: ToolServices
): ToolExecution {
  const startAt = normalizeDateTime(input.start_at) ?? new Date().toISOString()
  const endAt =
    (input.end_at ? normalizeDateTime(input.end_at) : null) ??
    (isAllDayStamp(startAt) ? `${startAt}T23:59:59.999Z` : startAt)
  const events = services.calendar.getEvents({ start: startAt, end: endAt })
  const lines = events.map((e) => `${e.id} | ${eventSummaryLine(e)}`)
  return {
    output: events.length > 0 ? lines.join('\n') : '该时间范围内没有日程',
    summary: `查询到 ${events.length} 个日程`,
    isError: false
  }
}
