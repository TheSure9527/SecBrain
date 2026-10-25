import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'
import { EventStore } from '../../src/main/calendar/event-store'
import { CalendarService } from '../../src/main/calendar/calendar-service'
import type { CalDavClient } from '../../src/main/calendar/caldav-client'
import type { SyncEngine } from '../../src/main/calendar/sync-engine'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let store: EventStore
let service: CalendarService

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  store = new EventStore(db)
  store.ensureLocalCalendar()
  // 未连接云端：只测本地校验逻辑
  const client = { isConnected: () => false } as unknown as CalDavClient
  service = new CalendarService(store, client)
})

afterEach(() => db.close())

const base = {
  title: '准备中期答辩材料',
  startAt: new Date(2026, 9, 26, 9, 0).toISOString(),
  endAt: new Date(2026, 9, 26, 9, 30).toISOString(),
  allDay: false
}

describe('事件创建：日历能力校验', () => {
  it('普通日历（VEVENT）可以创建事件', async () => {
    store.upsertCalendar({
      id: 'cal-work',
      url: 'https://caldav.icloud.com/x/calendars/work/',
      displayName: '工作',
      color: '#e35d6a',
      source: 'caldav',
      components: ['VEVENT']
    })
    const event = await service.createEvent({ ...base, calendarId: 'cal-work' })
    expect(event.title).toBe('准备中期答辩材料')
    expect(event.calendarId).toBe('cal-work')
  })

  it('写向提醒列表（VTODO）会被纠正，绝不会落进提醒集合', async () => {
    store.upsertCalendar({
      id: 'cal-reminders',
      url: 'https://caldav.icloud.com/x/calendars/reminders/',
      displayName: '提醒 ⚠️',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })
    const event = await service.createEvent({ ...base, calendarId: 'cal-reminders' })
    // 没有可用云端日历时退回本地，仍然不会写进 VTODO
    expect(event.calendarId).toBe('local')
    expect(store.getStoredEventById(event.id)?.calendarId).not.toBe('cal-reminders')
  })

  it('未指定日历（走本地默认）不受影响', async () => {
    const event = await service.createEvent(base)
    expect(event.calendarId).toBe('local')
  })

  it('推送云端失败时提示用户，而不是静默成功', async () => {
    store.upsertCalendar({
      id: 'cal-work',
      url: 'https://caldav.icloud.com/x/calendars/work/',
      displayName: '工作',
      color: '#e35d6a',
      source: 'caldav',
      components: ['VEVENT']
    })
    const client = { isConnected: () => true } as unknown as CalDavClient
    const svc = new CalendarService(store, client)
    svc.attachSyncEngine({
      pushCreate: async () => {
        throw new Error('HTTP 403')
      }
    } as unknown as SyncEngine)
    const notices: string[] = []
    svc.notify = (title: string): void => {
      notices.push(title)
    }

    const event = await svc.createEvent({ ...base, calendarId: 'cal-work' })
    expect(event.title).toBe('准备中期答辩材料')
    expect(notices.join(' ')).toContain('未同步')
  })

  it('未指定日历时默认落到云端真日历（不是提醒列表、也不是本地）', async () => {
    store.upsertCalendar({
      id: 'cal-personal',
      url: 'https://caldav.icloud.com/x/calendars/personal/',
      displayName: '个人',
      color: '#4fa3e3',
      source: 'caldav',
      components: ['VEVENT']
    })
    store.upsertCalendar({
      id: 'cal-reminders',
      url: 'https://caldav.icloud.com/x/calendars/reminders/',
      displayName: '提醒 ⚠️',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })

    const event = await service.createEvent(base)
    expect(event.calendarId).toBe('cal-personal')
  })

  it('显式指定提醒列表时会纠正到可用日历', async () => {
    store.upsertCalendar({
      id: 'cal-personal',
      url: 'https://caldav.icloud.com/x/calendars/personal/',
      displayName: '个人',
      color: '#4fa3e3',
      source: 'caldav',
      components: ['VEVENT']
    })
    store.upsertCalendar({
      id: 'cal-reminders',
      url: 'https://caldav.icloud.com/x/calendars/reminders/',
      displayName: '提醒 ⚠️',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })

    const event = await service.createEvent({ ...base, calendarId: 'cal-reminders' })
    expect(event.calendarId).toBe('cal-personal')
  })

  it('可在提醒列表新建 / 删除提醒', async () => {
    store.upsertCalendar({
      id: 'cal-reminders',
      url: 'https://caldav.icloud.com/x/calendars/reminders/',
      displayName: '提醒 ⚠️',
      color: '#3fae8a',
      source: 'caldav',
      components: ['VTODO']
    })
    // 未连接云端：先落本地
    const list = await service.createReminder({
      calendarId: 'cal-reminders',
      title: '交中期材料',
      dueAt: '2026-10-26T01:00:00.000Z',
      priority: 3
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      title: '交中期材料',
      completed: false,
      priority: 3,
      calendarName: '提醒 ⚠️'
    })

    const uid = list[0]!.uid
    const afterDelete = await service.deleteReminder('cal-reminders', uid)
    expect(afterDelete).toHaveLength(0)
  })

  it('不能往普通日历里新建提醒', async () => {
    store.upsertCalendar({
      id: 'cal-work',
      url: 'https://caldav.icloud.com/x/calendars/work/',
      displayName: '工作',
      color: '#e35d6a',
      source: 'caldav',
      components: ['VEVENT']
    })
    await expect(
      service.createReminder({ calendarId: 'cal-work', title: 'x' })
    ).rejects.toThrow(/不是提醒列表/)
  })
})
