import { describe, expect, it } from 'vitest'
import {
  detectConflicts,
  eventToRange,
  rangesOverlap,
  suggestSlots
} from '../../src/main/calendar/conflict'
import type { CalendarEvent } from '../../src/shared/calendar'

/** 本地时间构造（测试不依赖运行机时区） */
const at = (y: number, m: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, m - 1, d, h, mi)
const iso = (d: Date): string => d.toISOString()

function makeEvent(id: string, start: Date, end: Date, allDay = false): CalendarEvent {
  return {
    id,
    uid: id,
    calendarId: 'local',
    title: `事件 ${id}`,
    description: '',
    location: '',
    startAt: allDay ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` : iso(start),
    endAt: allDay ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` : iso(end),
    allDay,
    rrule: null,
    reminderMinutes: null,
    color: '#7c6cf0',
    isOccurrence: false
  }
}

describe('rangesOverlap', () => {
  it('部分重叠为 true', () => {
    expect(
      rangesOverlap(
        { start: at(2026, 10, 23, 10), end: at(2026, 10, 23, 11) },
        { start: at(2026, 10, 23, 10, 30), end: at(2026, 10, 23, 12) }
      )
    ).toBe(true)
  })

  it('包含关系为 true', () => {
    expect(
      rangesOverlap(
        { start: at(2026, 10, 23, 9), end: at(2026, 10, 23, 12) },
        { start: at(2026, 10, 23, 10), end: at(2026, 10, 23, 11) }
      )
    ).toBe(true)
  })

  it('端点相接不算重叠', () => {
    expect(
      rangesOverlap(
        { start: at(2026, 10, 23, 10), end: at(2026, 10, 23, 11) },
        { start: at(2026, 10, 23, 11), end: at(2026, 10, 23, 12) }
      )
    ).toBe(false)
  })

  it('完全分离为 false', () => {
    expect(
      rangesOverlap(
        { start: at(2026, 10, 23, 10), end: at(2026, 10, 23, 11) },
        { start: at(2026, 10, 24, 10), end: at(2026, 10, 24, 11) }
      )
    ).toBe(false)
  })
})

describe('eventToRange', () => {
  it('全天事件覆盖整天', () => {
    const range = eventToRange({ startAt: '2026-10-23', endAt: '2026-10-23', allDay: true })
    expect(range.start.getHours()).toBe(0)
    expect(range.end.getHours()).toBe(23)
  })
})

describe('detectConflicts', () => {
  const busy = [
    makeEvent('a', at(2026, 10, 23, 10), at(2026, 10, 23, 11)),
    makeEvent('b', at(2026, 10, 23, 14), at(2026, 10, 23, 15)),
    makeEvent('allday', at(2026, 10, 24), at(2026, 10, 24), true)
  ]

  it('命中重叠事件', () => {
    const conflicts = detectConflicts(busy, {
      startAt: iso(at(2026, 10, 23, 10, 30)),
      endAt: iso(at(2026, 10, 23, 10, 45)),
      allDay: false
    })
    expect(conflicts.map((c) => c.id)).toEqual(['a'])
  })

  it('无重叠返回空', () => {
    const conflicts = detectConflicts(busy, {
      startAt: iso(at(2026, 10, 23, 11)),
      endAt: iso(at(2026, 10, 23, 11, 30)),
      allDay: false
    })
    expect(conflicts).toHaveLength(0)
  })

  it('排除自身（编辑场景）', () => {
    const conflicts = detectConflicts(busy, {
      startAt: iso(at(2026, 10, 23, 10, 30)),
      endAt: iso(at(2026, 10, 23, 10, 45)),
      allDay: false,
      excludeEventId: 'a'
    })
    expect(conflicts).toHaveLength(0)
  })

  it('定时候选与全天事件在同一天算冲突', () => {
    const conflicts = detectConflicts(busy, {
      startAt: iso(at(2026, 10, 24, 20)),
      endAt: iso(at(2026, 10, 24, 21)),
      allDay: false
    })
    expect(conflicts.map((c) => c.id)).toContain('allday')
  })
})

describe('suggestSlots', () => {
  it('返回请求数量的时段且按时间升序', () => {
    const slots = suggestSlots([], {
      durationMinutes: 60,
      bufferMinutes: 15,
      workStartHour: 9,
      workEndHour: 18,
      from: at(2026, 10, 23, 9),
      count: 3
    })
    expect(slots).toHaveLength(3)
    expect(slots[0]!.startAt < slots[1]!.startAt).toBe(true)
  })

  it('推荐时段避开忙时段（含缓冲）', () => {
    const busy = [makeEvent('x', at(2026, 10, 23, 12), at(2026, 10, 23, 13))]
    const slots = suggestSlots(busy, {
      durationMinutes: 60,
      bufferMinutes: 15,
      workStartHour: 9,
      workEndHour: 18,
      from: at(2026, 10, 23, 9),
      count: 10
    })
    expect(slots.length).toBeGreaterThan(0)
    const buffered = {
      start: at(2026, 10, 23, 11, 45),
      end: at(2026, 10, 23, 13, 15)
    }
    for (const slot of slots) {
      const range = eventToRange({
        startAt: slot.startAt,
        endAt: slot.endAt,
        allDay: false
      })
      expect(rangesOverlap(range, buffered)).toBe(false)
    }
  })

  it('已过工作时段时从次日工作时段开始', () => {
    const slots = suggestSlots([], {
      durationMinutes: 60,
      bufferMinutes: 0,
      workStartHour: 9,
      workEndHour: 18,
      from: at(2026, 10, 23, 20),
      days: 2,
      count: 2
    })
    expect(slots[0]!.startAt).toBe(iso(at(2026, 10, 24, 9)))
  })

  it('日历排满时返回空', () => {
    const fullDay = [makeEvent('full', at(2026, 10, 23, 8), at(2026, 10, 23, 19))]
    const slots = suggestSlots(fullDay, {
      durationMinutes: 60,
      bufferMinutes: 0,
      workStartHour: 9,
      workEndHour: 18,
      from: at(2026, 10, 23, 9),
      days: 1,
      count: 3
    })
    expect(slots).toHaveLength(0)
  })
})
