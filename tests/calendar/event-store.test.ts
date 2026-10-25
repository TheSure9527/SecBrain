import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'
import { EventStore, LOCAL_CALENDAR_ID } from '../../src/main/calendar/event-store'

// node:sqlite 不在 Node builtinModules 列表中，vite 无法静态解析
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let store: EventStore

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  store = new EventStore(db)
  store.ensureLocalCalendar()
})

afterEach(() => db.close())

const local = (y: number, m: number, d: number, h = 0, mi = 0): string =>
  new Date(y, m - 1, d, h, mi).toISOString()

describe('EventStore 日历', () => {
  it('ensureLocalCalendar 幂等', () => {
    store.ensureLocalCalendar()
    store.ensureLocalCalendar()
    expect(store.listCalendars()).toHaveLength(1)
    expect(store.getCalendar(LOCAL_CALENDAR_ID)?.source).toBe('local')
  })

  it('记录服务器声明的分量类型（VTODO 提醒列表）', () => {
    store.upsertCalendar({
      id: 'cal-reminders',
      url: 'https://caldav.icloud.com/x/calendars/reminders/',
      displayName: '提醒',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })
    const reminders = store.getCalendar('cal-reminders')
    expect(reminders?.components).toEqual(['VTODO'])
    // 本地日历缺省按 VEVENT 处理
    expect(store.getCalendar(LOCAL_CALENDAR_ID)?.components).toEqual(['VEVENT'])
    // 再次同步时更新分量类型
    store.upsertCalendar({
      id: 'cal-reminders',
      url: 'https://caldav.icloud.com/x/calendars/reminders/',
      displayName: '提醒',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO', 'VEVENT']
    })
    expect(store.getCalendar('cal-reminders')?.components).toEqual(['VTODO', 'VEVENT'])
  })

  it('upsert / list / remove 日历', () => {
    store.upsertCalendar({
      id: 'cal-1',
      url: 'https://example.com/cal/1',
      displayName: '工作',
      color: '#f00',
      source: 'caldav'
    })
    expect(store.listCalendars().map((c) => c.id)).toContain('cal-1')
    store.removeCalendar('cal-1')
    expect(store.listCalendars().some((c) => c.id === 'cal-1')).toBe(false)
  })
})

describe('EventStore 事件 CRUD', () => {
  it('创建后可读回', () => {
    const event = store.createEvent({
      title: '测试事件',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false,
      reminderMinutes: 15
    })
    expect(event.title).toBe('测试事件')
    expect(event.allDay).toBe(false)
    expect(event.reminderMinutes).toBe(15)
    expect(event.calendarId).toBe(LOCAL_CALENDAR_ID)

    const reread = store.getEventById(event.id)
    expect(reread?.title).toBe('测试事件')
  })

  it('更新保留未提供的字段', () => {
    const event = store.createEvent({
      title: '原标题',
      description: '描述',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false
    })
    const updated = store.updateEvent({ id: event.id, title: '新标题' })
    expect(updated.title).toBe('新标题')
    expect(updated.description).toBe('描述')
  })

  it('删除后不可读', () => {
    const event = store.createEvent({
      title: '待删',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false
    })
    store.deleteEvent(event.id)
    expect(store.getEventById(event.id)).toBeNull()
  })

  it('全天事件存储为日期戳', () => {
    const event = store.createEvent({
      title: '全天',
      startAt: '2026-10-25',
      endAt: '2026-10-25',
      allDay: true
    })
    expect(event.startAt).toBe('2026-10-25')
    expect(event.allDay).toBe(true)
  })
})

describe('EventStore 范围查询', () => {
  beforeEach(() => {
    store.createEvent({
      title: '范围内',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false
    })
    store.createEvent({
      title: '范围外-过去',
      startAt: local(2026, 1, 1, 10),
      endAt: local(2026, 1, 1, 11),
      allDay: false
    })
    store.createEvent({
      title: '范围外-未来',
      startAt: local(2027, 1, 1, 10),
      endAt: local(2027, 1, 1, 11),
      allDay: false
    })
    store.createEvent({
      title: '跨天全天',
      startAt: '2026-10-24',
      endAt: '2026-10-26',
      allDay: true
    })
  })

  it('只返回范围内事件', () => {
    const events = store.eventsInRange(local(2026, 10, 23), local(2026, 10, 23, 23, 59))
    expect(events.map((e) => e.title).sort()).toEqual(['范围内'])
  })

  it('跨天全天事件在每个覆盖日都可见', () => {
    const day2 = store.eventsInRange(local(2026, 10, 25), local(2026, 10, 25, 23, 59))
    expect(day2.map((e) => e.title)).toContain('跨天全天')
  })
})

describe('EventStore 重复事件展开', () => {
  it('每日重复在范围内生成多个实例', () => {
    store.createEvent({
      title: '每日站会',
      startAt: local(2026, 10, 20, 8),
      endAt: local(2026, 10, 20, 8, 30),
      allDay: false,
      rrule: 'FREQ=DAILY;COUNT=10'
    })
    const events = store.eventsInRange(local(2026, 10, 22), local(2026, 10, 24, 23, 59))
    const standups = events.filter((e) => e.title === '每日站会')
    expect(standups).toHaveLength(3)
    expect(standups.every((e) => e.isOccurrence)).toBe(true)
    expect(standups[0]!.id).toContain('::')
  })

  it('实例时间正确平移', () => {
    store.createEvent({
      title: '每周会',
      startAt: local(2026, 10, 19, 14),
      endAt: local(2026, 10, 19, 15),
      allDay: false,
      rrule: 'FREQ=WEEKLY'
    })
    const events = store.eventsInRange(local(2026, 10, 26), local(2026, 10, 26, 23, 59))
    const meeting = events.find((e) => e.title === '每周会')
    expect(meeting).toBeDefined()
    expect(new Date(meeting!.startAt).getHours()).toBe(14)
  })

  it('编辑主事件后实例跟随', () => {
    const event = store.createEvent({
      title: '每日',
      startAt: local(2026, 10, 20, 8),
      endAt: local(2026, 10, 20, 8, 30),
      allDay: false,
      rrule: 'FREQ=DAILY;COUNT=3'
    })
    store.updateEvent({ id: event.id, title: '每日（改）' })
    const events = store.eventsInRange(local(2026, 10, 21), local(2026, 10, 21, 23, 59))
    expect(events[0]!.title).toBe('每日（改）')
  })
})

describe('EventStore 提醒', () => {
  it('到期的提醒事件被检出', () => {
    store.createEvent({
      title: '带提醒',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false,
      reminderMinutes: 15
    })
    // 提前 15 分钟 = 9:45，9:44 时未到
    expect(store.dueReminderEvents(new Date(2026, 9, 23, 9, 44))).toHaveLength(0)
    // 9:46 时已到点
    const due = store.dueReminderEvents(new Date(2026, 9, 23, 9, 46))
    expect(due.map((e) => e.title)).toEqual(['带提醒'])
  })

  it('已触发的提醒不重复检出', () => {
    store.createEvent({
      title: '一次性',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false,
      reminderMinutes: 15
    })
    const due = store.dueReminderEvents(new Date(2026, 9, 23, 9, 46))
    for (const event of due) {
      store.markReminderFired(event.id)
    }
    expect(store.isReminderFired(due[0]!.id)).toBe(true)
  })

  it('无提醒的事件不检出', () => {
    store.createEvent({
      title: '无提醒',
      startAt: local(2026, 10, 23, 10),
      endAt: local(2026, 10, 23, 11),
      allDay: false,
      reminderMinutes: null
    })
    expect(store.dueReminderEvents(new Date(2026, 9, 23, 9, 46))).toHaveLength(0)
  })
})

describe('EventStore 提醒事项（VTODO）', () => {
  it('写入 / 读取 / 完成 / 清理', () => {
    store.upsertCalendar({
      id: 'cal-todo',
      url: 'https://caldav.icloud.com/x/calendars/todo/',
      displayName: '提醒',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })
    store.upsertReminder({
      calendarId: 'cal-todo',
      uid: 't1',
      title: '准备中期答辩材料',
      notes: '下周一上午',
      dueAt: '2026-10-26T01:00:00.000Z',
      priority: 5,
      completed: false,
      completedAt: null,
      url: 'https://caldav.icloud.com/x/calendars/todo/t1.ics',
      etag: 'e1'
    })
    store.upsertReminder({
      calendarId: 'cal-todo',
      uid: 't2',
      title: '交材料',
      notes: '',
      dueAt: null,
      priority: 0,
      completed: false,
      completedAt: null
    })

    const pending = store.listReminders()
    expect(pending).toHaveLength(2)
    expect(pending[0]!.calendarName).toBe('提醒')

    store.setReminderCompleted('cal-todo', 't1', true)
    expect(store.listReminders()).toHaveLength(1)
    expect(store.listReminders({ includeCompleted: true })).toHaveLength(2)
    expect(store.getReminder('cal-todo', 't1')?.completed).toBe(true)

    // 远端已删除的提醒要清理
    expect(store.removeRemindersNotIn('cal-todo', ['t2'])).toBe(1)
    expect(store.listReminders({ includeCompleted: true }).map((r) => r.uid)).toEqual(['t2'])
  })

  it('重复同步不会覆盖已有 url/etag 为空', () => {
    store.upsertCalendar({
      id: 'cal-todo',
      url: 'https://caldav.icloud.com/x/calendars/todo/',
      displayName: '提醒',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })
    store.upsertReminder({
      calendarId: 'cal-todo',
      uid: 't1',
      title: 'A',
      notes: '',
      dueAt: null,
      priority: 0,
      completed: false,
      completedAt: null,
      url: 'https://x/t1.ics',
      etag: 'e1'
    })
    store.upsertReminder({
      calendarId: 'cal-todo',
      uid: 't1',
      title: 'A2',
      notes: '',
      dueAt: null,
      priority: 0,
      completed: false,
      completedAt: null
    })
    const saved = store.getReminder('cal-todo', 't1')
    expect(saved?.title).toBe('A2')
    expect(saved?.url).toBe('https://x/t1.ics')
    expect(saved?.etag).toBe('e1')
  })
})
