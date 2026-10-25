import type { CalendarEvent, TimeSlot } from '../../shared/calendar'
import { isAllDayStamp } from '../domain'

export interface DateRange {
  start: Date
  end: Date
}

/** 事件模型 → 可比较的时间范围（全天事件覆盖整天，含式结束） */
export function eventToRange(event: {
  startAt: string
  endAt: string
  allDay: boolean
}): DateRange {
  const start = isAllDayStamp(event.startAt)
    ? new Date(`${event.startAt}T00:00:00`)
    : new Date(event.startAt)
  const end = isAllDayStamp(event.endAt)
    ? new Date(`${event.endAt}T23:59:59.999`)
    : new Date(event.endAt)
  return { start, end }
}

/** 两个时间段是否重叠（端点相接不算） */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start < b.end && b.start < a.end
}

/** 候选事件与已有事件列表的冲突项 */
export function detectConflicts(
  events: CalendarEvent[],
  candidate: { startAt: string; endAt: string; allDay: boolean; excludeEventId?: string }
): CalendarEvent[] {
  const candidateRange = eventToRange(candidate)
  return events.filter((event) => {
    if (candidate.excludeEventId && event.id === candidate.excludeEventId) return false
    if (candidate.excludeEventId && event.id.startsWith(`${candidate.excludeEventId}::`)) return false
    return rangesOverlap(candidateRange, eventToRange(event))
  })
}

export interface SuggestOptions {
  /** 会议时长（分钟） */
  durationMinutes: number
  bufferMinutes: number
  workStartHour: number
  workEndHour: number
  /** 从何时开始找（默认现在） */
  from?: Date
  /** 搜索天数（默认 7） */
  days?: number
  /** 返回几个建议（默认 3） */
  count?: number
}

/**
 * 推荐可用时段：在之后 N 天的工作时段内，以 30 分钟为粒度
 * 找到不与任何事件（含缓冲）重叠的最早空档。
 */
export function suggestSlots(
  events: CalendarEvent[],
  options: SuggestOptions
): TimeSlot[] {
  const {
    durationMinutes,
    bufferMinutes,
    workStartHour,
    workEndHour,
    from = new Date(),
    days = 7,
    count = 3
  } = options

  const busy = events.map(eventToRange)
  const slots: TimeSlot[] = []
  const slotMs = 30 * 60 * 1000
  const durationMs = durationMinutes * 60 * 1000
  const bufferMs = bufferMinutes * 60 * 1000

  const startDay = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let d = 0; d < days && slots.length < count; d += 1) {
    const day = new Date(startDay)
    day.setDate(day.getDate() + d)

    let cursor = new Date(day)
    cursor.setHours(workStartHour, 0, 0, 0)
    if (d === 0) {
      // 今天：从「现在」之后开始，向上取整到 30 分钟
      const nextHalf = new Date(Math.ceil(from.getTime() / slotMs) * slotMs)
      if (nextHalf > cursor) cursor = nextHalf
    }
    const dayEnd = new Date(day)
    dayEnd.setHours(workEndHour, 0, 0, 0)

    while (cursor.getTime() + durationMs <= dayEnd.getTime() && slots.length < count) {
      const slot: DateRange = {
        start: new Date(cursor),
        end: new Date(cursor.getTime() + durationMs)
      }
      const withBuffer: DateRange = {
        start: new Date(slot.start.getTime() - bufferMs),
        end: new Date(slot.end.getTime() + bufferMs)
      }
      const conflict = busy.some((range) => rangesOverlap(withBuffer, range))
      if (!conflict) {
        slots.push({
          startAt: slot.start.toISOString(),
          endAt: slot.end.toISOString()
        })
      }
      cursor = new Date(cursor.getTime() + slotMs)
    }
  }
  return slots
}
