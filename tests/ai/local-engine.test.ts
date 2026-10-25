import { describe, expect, it, vi } from 'vitest'
import { LocalEngine } from '../../src/main/ai/local-engine'
import type { ToolServices } from '../../src/main/ai/tools/types'

function makeServices(overrides: Partial<ToolServices> = {}): ToolServices {
  return {
    calendar: {
      listCalendars: () => [
        {
          id: 'cal-personal',
          url: 'https://caldav.icloud.com/x/personal/',
          displayName: '个人',
          color: '#4fa3e3',
          source: 'caldav',
          components: ['VEVENT']
        }
      ],
      getEvents: () => [
        {
          id: 'cal-personal::e1',
          calendarId: 'cal-personal',
          title: '组会',
          startAt: '2026-10-26T01:00:00.000Z',
          endAt: '2026-10-26T02:00:00.000Z',
          allDay: false,
          description: '',
          location: '',
          rrule: null,
          reminderMinutes: null
        }
      ],
      createEvent: vi.fn(async (input: { title: string; startAt: string }) => ({
        id: 'cal-personal::new',
        calendarId: 'cal-personal',
        title: input.title,
        startAt: input.startAt,
        endAt: input.startAt,
        allDay: false,
        description: '',
        location: '',
        rrule: null,
        reminderMinutes: null
      })),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      checkConflicts: vi.fn(),
      suggestSlots: vi.fn(),
      getAccountStatus: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      syncNow: vi.fn(),
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
      listReminders: () => [],
      setReminderCompleted: vi.fn(),
      listReminderCalendars: () => [],
      createReminder: vi.fn(),
      deleteReminder: vi.fn(),
      notify: vi.fn()
    } as unknown as ToolServices['calendar'],
    tasks: {
      list: () => [
        {
          id: 't1',
          title: '交材料',
          notes: '',
          dueAt: null,
          allDay: false,
          priority: 1,
          status: 'todo',
          tags: [],
          notePath: null,
          eventId: null,
          createdAt: '2026-10-25T00:00:00.000Z',
          completedAt: null
        }
      ],
      counts: () => ({ today: 1, week: 1, all: 1, done: 0 }),
      create: vi.fn((input: { title: string; dueAt: string | null }) => ({
        id: 't2',
        title: input.title,
        dueAt: input.dueAt,
        allDay: false,
        notes: '',
        priority: 0,
        status: 'todo',
        tags: [],
        notePath: null,
        eventId: null,
        createdAt: '2026-10-25T00:00:00.000Z',
        completedAt: null
      })),
      update: vi.fn(),
      complete: vi.fn(),
      delete: vi.fn(),
      convertToEvent: vi.fn()
    } as unknown as ToolServices['tasks'],
    notes: {
      searchNotes: () => [],
      listNotes: () => [],
      readNote: async () => null,
      createNote: async (input: { title: string; content: string }) => ({
        path: `${input.title}.md`,
        title: input.title,
        content: input.content,
        tags: [],
        createdAt: '2026-10-25T00:00:00.000Z',
        props: {}
      })
    } as unknown as ToolServices['notes'],
    semantic: null,
    documents: null,
    ...overrides
  }
}

describe('LocalEngine 意图识别', () => {
  const engine = new LocalEngine(makeServices())

  it.each([
    ['我今天有什么安排', 'agenda'],
    ['明天有什么日程', 'agenda'],
    ['我还有哪些待办', 'tasks'],
    ['提醒我明天下午三点开会', 'create_event'],
    ['提醒我周五交材料', 'create_task'],
    ['记一条：明天买牛奶', 'create_note'],
    ['帮我找一下卡口运维的资料', 'search'],
    ['帮助', 'help']
  ])('「%s」→ %s', (text, expected) => {
    expect(engine.classify(text)).toBe(expected)
  })
})

describe('LocalEngine 执行', () => {
  it('查日程会汇总事件与待办', async () => {
    const engine = new LocalEngine(makeServices())
    const reply = await engine.reply('我今天有什么安排')
    expect(reply.text).toContain('组会')
    expect(reply.text).toContain('交材料')
  })

  it('创建事件时解析时间并落到日历', async () => {
    const services = makeServices()
    const engine = new LocalEngine(services)
    const reply = await engine.reply('提醒我明天下午三点开会')
    expect(services.calendar.createEvent).toHaveBeenCalledTimes(1)
    const input = (services.calendar.createEvent as unknown as { mock: { calls: Array<[Record<string, unknown>]> } })
      .mock.calls[0]![0] as { title: string; startAt: string }
    expect(input.title).toContain('开会')
    expect(new Date(input.startAt).getHours()).toBe(15)
    expect(reply.toolCalls[0]?.ok).toBe(true)
  })

  it('没有时间时给出可读提示，不误建事件', async () => {
    const services = makeServices()
    const engine = new LocalEngine(services)
    const reply = await engine.reply('提醒我开会')
    expect(services.calendar.createEvent).not.toHaveBeenCalled()
    expect(reply.text).toContain('没能')
  })

  it('创建任务时把标题与时间分开', async () => {
    const services = makeServices()
    const engine = new LocalEngine(services)
    const reply = await engine.reply('提醒我周五交材料')
    expect(services.tasks.create).toHaveBeenCalledTimes(1)
    const input = (services.tasks.create as unknown as { mock: { calls: Array<[Record<string, unknown>]> } })
      .mock.calls[0]![0] as { title: string; dueAt: string | null }
    expect(input.title).toContain('交材料')
    expect(input.title).not.toContain('周五')
    expect(reply.text).toContain('已创建任务')
  })

  it('「记一条」会建笔记并给出引用', async () => {
    const engine = new LocalEngine(makeServices())
    const reply = await engine.reply('记一条：明天买牛奶')
    expect(reply.text).toContain('已创建笔记')
    expect(reply.references[0]?.path).toContain('.md')
  })
})
