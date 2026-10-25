import { describe, expect, it } from 'vitest'
import {
  buildVCalendar,
  buildVEventString,
  buildVTodoString,
  parseICalEvents,
  parseVTodos
} from '../../src/main/calendar/ical'

const TIMED_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//CN
BEGIN:VEVENT
UID:evt-1
DTSTAMP:20261023T000000Z
DTSTART:20261023T060000Z
DTEND:20261023T070000Z
SUMMARY:团队周会
DESCRIPTION:讨论 M3 进度
LOCATION:会议室 A
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:团队周会
END:VALARM
END:VEVENT
END:VCALENDAR`

const ALL_DAY_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-2
DTSTART;VALUE=DATE:20261025
DTEND;VALUE=DATE:20261026
SUMMARY:团建
END:VEVENT
END:VCALENDAR`

const RECUR_ICAL = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-3
DTSTART:20261001T080000Z
DTEND:20261001T083000Z
SUMMARY:每日站会
RRULE:FREQ=DAILY;COUNT=5
END:VEVENT
END:VCALENDAR`

describe('parseICalEvents', () => {
  it('解析定时事件（UTC 存储）', () => {
    const events = parseICalEvents(TIMED_ICAL)
    expect(events).toHaveLength(1)
    const e = events[0]!
    expect(e.uid).toBe('evt-1')
    expect(e.title).toBe('团队周会')
    expect(e.description).toBe('讨论 M3 进度')
    expect(e.location).toBe('会议室 A')
    expect(e.startAt).toBe('2026-10-23T06:00:00.000Z')
    expect(e.endAt).toBe('2026-10-23T07:00:00.000Z')
    expect(e.allDay).toBe(false)
    expect(e.reminderMinutes).toBe(15)
  })

  it('解析全天事件为日期戳', () => {
    const events = parseICalEvents(ALL_DAY_ICAL)
    expect(events).toHaveLength(1)
    expect(events[0]!.allDay).toBe(true)
    expect(events[0]!.startAt).toBe('2026-10-25')
    expect(events[0]!.endAt).toBe('2026-10-26')
    expect(events[0]!.reminderMinutes).toBeNull()
  })

  it('解析 RRULE', () => {
    const events = parseICalEvents(RECUR_ICAL)
    expect(events[0]!.rrule).toContain('FREQ=DAILY')
    expect(events[0]!.rrule).toContain('COUNT=5')
  })

  it('非法输入返回空数组', () => {
    expect(parseICalEvents('这不是 iCalendar')).toEqual([])
    expect(parseICalEvents('')).toEqual([])
  })

  it('跳过结构损坏的单个 VEVENT', () => {
    const broken = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:bad
SUMMARY:坏事件
END:VEVENT
END:VCALENDAR`
    // 缺 DTSTART 的事件应被跳过而不是抛错
    const events = parseICalEvents(broken)
    expect(Array.isArray(events)).toBe(true)
  })
})

describe('buildVEventString / parse 往返', () => {
  it('定时事件往返一致', () => {
    const input = {
      uid: 'round-1',
      title: '往返测试',
      description: '描述',
      location: '地点',
      startAt: '2026-10-23T06:00:00.000Z',
      endAt: '2026-10-23T07:30:00.000Z',
      allDay: false,
      rrule: null,
      reminderMinutes: 30
    }
    const parsed = parseICalEvents(buildVEventString(input))[0]!
    expect(parsed.uid).toBe('round-1')
    expect(parsed.title).toBe('往返测试')
    expect(parsed.description).toBe('描述')
    expect(parsed.location).toBe('地点')
    expect(parsed.startAt).toBe('2026-10-23T06:00:00.000Z')
    expect(parsed.endAt).toBe('2026-10-23T07:30:00.000Z')
    expect(parsed.allDay).toBe(false)
    expect(parsed.reminderMinutes).toBe(30)
  })

  it('全天事件往返一致', () => {
    const input = {
      uid: 'round-2',
      title: '全天往返',
      startAt: '2026-10-25',
      endAt: '2026-10-25',
      allDay: true
    }
    const parsed = parseICalEvents(buildVEventString(input))[0]!
    expect(parsed.allDay).toBe(true)
    expect(parsed.startAt).toBe('2026-10-25')
    expect(parsed.endAt).toBe('2026-10-25')
  })

  it('重复事件往返保留 RRULE', () => {
    const input = {
      uid: 'round-3',
      title: '每周重复',
      startAt: '2026-10-23T06:00:00.000Z',
      endAt: '2026-10-23T07:00:00.000Z',
      allDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=FR'
    }
    const parsed = parseICalEvents(buildVEventString(input))[0]!
    expect(parsed.rrule).toContain('FREQ=WEEKLY')
    expect(parsed.rrule).toContain('BYDAY=FR')
  })

  it('含特殊字符的标题不破坏结构', () => {
    const input = {
      uid: 'round-4',
      title: '标题, 带; 分号\n和换行',
      startAt: '2026-10-23T06:00:00.000Z',
      endAt: '2026-10-23T07:00:00.000Z',
      allDay: false
    }
    const parsed = parseICalEvents(buildVEventString(input))[0]!
    expect(parsed.title).toBe('标题, 带; 分号\n和换行')
  })
})


describe('VTODO（提醒事项）', () => {
  it('解析提醒：标题 / 截止 / 完成状态 / 优先级', () => {
    const ics = buildVTodoString({
      uid: 'todo-1',
      title: '准备中期答辩材料',
      notes: '下周一上午',
      dueAt: '2026-10-26T01:00:00.000Z',
      priority: 5,
      completed: false
    })
    const [todo] = parseVTodos(ics)
    expect(todo).toMatchObject({
      uid: 'todo-1',
      title: '准备中期答辩材料',
      notes: '下周一上午',
      completed: false,
      priority: 5
    })
    expect(todo!.dueAt).toBe('2026-10-26T01:00:00.000Z')
  })

  it('完成状态与完成时间可往返', () => {
    const ics = buildVTodoString({
      uid: 'todo-2',
      title: '交材料',
      completed: true,
      completedAt: '2026-10-25T02:03:04.000Z'
    })
    const [todo] = parseVTodos(ics)
    expect(todo!.completed).toBe(true)
    expect(todo!.completedAt).toBe('2026-10-25T02:03:04.000Z')
  })

  it('非法内容返回空数组', () => {
    expect(parseVTodos('not an ics')).toEqual([])
  })
})

describe('批量导出 VCALENDAR', () => {
  it('多个事件 + 全天 + 提醒 一起导出', () => {
    const ics = buildVCalendar({
      events: [
        {
          uid: 'e1',
          title: '组会',
          startAt: '2026-10-26T01:00:00.000Z',
          endAt: '2026-10-26T02:00:00.000Z',
          allDay: false
        },
        { uid: 'e2', title: '全天事务', startAt: '2026-10-27', endAt: '2026-10-27', allDay: true }
      ],
      todos: [{ uid: 't1', title: '交中期材料', completed: false, dueAt: '2026-10-28T01:00:00.000Z' }]
    })
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(1)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261027')
    // 导出后可被自己的解析器读回
    expect(parseICalEvents(ics)).toHaveLength(2)
    expect(parseVTodos(ics)).toHaveLength(1)
  })
})
