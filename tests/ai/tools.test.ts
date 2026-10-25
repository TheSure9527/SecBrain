import { describe, expect, it, vi } from 'vitest'
import { executeTool, normalizeDateTime } from '../../src/main/ai/tools'
import type { ToolServices } from '../../src/main/ai/tools'
import type { CalendarEvent } from '../../src/shared/calendar'
import type { Task } from '../../src/shared/tasks'

function makeEvent(id: string, title: string, startAt: string, endAt: string, allDay = false): CalendarEvent {
  return {
    id,
    uid: id,
    calendarId: 'local',
    title,
    description: '',
    location: '',
    startAt,
    endAt,
    allDay,
    rrule: null,
    reminderMinutes: null,
    color: '#888',
    isOccurrence: false
  }
}

function makeServices(overrides: Partial<ToolServices> = {}): ToolServices {
  const events: CalendarEvent[] = [
    makeEvent('local::a', '晨会', '2026-10-23T01:00:00.000Z', '2026-10-23T01:30:00.000Z')
  ]
  return {
    calendar: {
      listCalendars: () => [
        { id: 'local', url: 'local://', displayName: '本地日历', color: '#888', source: 'local' }
      ],
      getEvents: () => events,
      createEvent: vi.fn(async (input) => makeEvent('local::new', input.title, input.startAt, input.endAt, input.allDay)),
      updateEvent: vi.fn(async (input) => events[0]!),
      deleteEvent: vi.fn(async () => {}),
      notify: () => {},
      notifyReminder: () => {}
    } as unknown as ToolServices['calendar'],
    tasks: {
      list: () => [],
      counts: () => ({ today: 0, week: 0, all: 0, done: 0 }),
      create: vi.fn((input) => ({
        id: 'task-1',
        title: input.title,
        notes: '',
        dueAt: input.dueAt ?? null,
        allDay: input.allDay ?? false,
        priority: input.priority ?? 0,
        status: 'todo',
        tags: input.tags ?? [],
        notePath: null,
        eventId: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      })),
      update: vi.fn(),
      complete: vi.fn((id: string, done: boolean) => ({ id, title: `任务 ${id}`, status: done ? 'done' : 'todo' })),
      delete: vi.fn(),
      convertToEvent: vi.fn(async () => ({ task: { id: 'task-1' } as Task, eventId: 'local::e' })),
      notifyDue: () => {}
    } as unknown as ToolServices['tasks'],
    notes: {
      searchNotes: vi.fn((query: string) =>
        query.includes('obsidian') ? [{ path: 'a.md', title: 'Obsidian 研究', snippet: 'obsidian 是…' }] : []
      ),
      listNotes: () => [],
      readNote: async () => null,
      createNote: async () => ({}) as never,
      updateNote: async () => ({}) as never,
      deleteNote: async () => {},
      saveAttachment: async () => ({}) as never,
      init: async () => {},
      dispose: () => {}
    } as unknown as ToolServices['notes'],
    ...overrides
  }
}

describe('normalizeDateTime', () => {
  it('ISO 字符串原样通过（规范化为 ISO）', () => {
    const result = normalizeDateTime('2026-10-24T15:00:00+08:00')
    expect(result).toBe('2026-10-24T07:00:00.000Z')
  })

  it('日期戳原样通过', () => {
    expect(normalizeDateTime('2026-10-24')).toBe('2026-10-24')
  })

  it('中文自然语言「明天下午3点」', () => {
    const ref = new Date(2026, 9, 23, 10, 0)
    const result = normalizeDateTime('明天下午3点', ref)
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getDate()).toBe(24)
    expect(date.getHours()).toBe(15)
    expect(date.getMinutes()).toBe(0)
  })

  it('中文自然语言「下周五上午10点」', () => {
    const ref = new Date(2026, 9, 23, 10, 0)
    const result = normalizeDateTime('下周五上午10点', ref)
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getDay()).toBe(5)
    expect(date.getHours()).toBe(10)
  })

  it('英文自然语言 tomorrow at 3pm', () => {
    const ref = new Date(2026, 9, 23, 10, 0)
    const result = normalizeDateTime('tomorrow at 3pm', ref)
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getDate()).toBe(24)
    expect(date.getHours()).toBe(15)
  })

  it('无法解析返回 null', () => {
    expect(normalizeDateTime('随便一句没有时间的话')).toBeNull()
    expect(normalizeDateTime('')).toBeNull()
    expect(normalizeDateTime(undefined)).toBeNull()
  })
})

describe('executeTool', () => {
  it('create_event 归一化自然语言时间', async () => {
    const services = makeServices()
    const result = await executeTool(
      'create_event',
      { title: '给妈妈打电话', start_at: '明天下午3点' },
      services
    )
    expect(result.isError).toBe(false)
    expect(result.summary).toContain('给妈妈打电话')
    const createEvent = services.calendar.createEvent as unknown as ReturnType<typeof vi.fn>
    const input = createEvent.mock.calls[0]![0] as { startAt: string; endAt: string; allDay: boolean }
    const start = new Date(input.startAt)
    expect(start.getHours()).toBe(15)
    // 缺省结束 = 开始 + 1 小时
    expect(new Date(input.endAt).getTime() - start.getTime()).toBe(60 * 60 * 1000)
  })

  it('create_event 全天事件', async () => {
    const services = makeServices()
    const result = await executeTool(
      'create_event',
      { title: '团建', start_at: '2026-10-25', all_day: true },
      services
    )
    expect(result.isError).toBe(false)
    const createEvent = services.calendar.createEvent as unknown as ReturnType<typeof vi.fn>
    const input = createEvent.mock.calls[0]![0] as { startAt: string; endAt: string; allDay: boolean }
    expect(input.allDay).toBe(true)
    expect(input.startAt).toBe('2026-10-25')
    expect(input.endAt).toBe('2026-10-25')
  })

  it('create_event 缺少标题报错', async () => {
    const result = await executeTool('create_event', { start_at: '2026-10-24' }, makeServices())
    expect(result.isError).toBe(true)
  })

  it('create_event 无法解析时间报错', async () => {
    const result = await executeTool('create_event', { title: 'x', start_at: '鬼知道什么时候' }, makeServices())
    expect(result.isError).toBe(true)
  })

  it('query_events 返回事件列表', async () => {
    const result = await executeTool('query_events', { start_at: '2026-10-23', end_at: '2026-10-23' }, makeServices())
    expect(result.isError).toBe(false)
    expect(result.output).toContain('晨会')
    expect(result.output).toContain('local::a')
  })

  it('create_task 创建任务', async () => {
    const services = makeServices()
    const result = await executeTool('create_task', { title: '写周报', due_at: '本周五' }, services)
    expect(result.isError).toBe(false)
    expect(result.summary).toContain('写周报')
    const create = services.tasks.create as unknown as ReturnType<typeof vi.fn>
    const input = create.mock.calls[0]![0] as { dueAt: string | null }
    expect(input.dueAt).not.toBeNull()
  })

  it('complete_task', async () => {
    const result = await executeTool('complete_task', { task_id: 'task-1' }, makeServices())
    expect(result.isError).toBe(false)
    expect(result.summary).toContain('task-1')
  })

  it('search_notes 命中笔记', async () => {
    const result = await executeTool('search_notes', { query: 'obsidian 双链' }, makeServices())
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Obsidian 研究')
  })

  it('search_notes 无结果', async () => {
    const result = await executeTool('search_notes', { query: '不存在的词xyz' }, makeServices())
    expect(result.isError).toBe(false)
    expect(result.output).toContain('没有找到')
  })

  it('search_notes 多关键词拆词，并覆盖非 Markdown 材料', async () => {
    const documentsMock = {
      search: (query: string) =>
        query === '学历'
          ? [{ path: '履历/简历/我的简历.docx', title: '我的简历', snippet: '学历：硕士研究生' }]
          : [],
      searchByPath: () => [],
      getText: () => null
    }
    const result = await executeTool(
      'search_notes',
      { query: '学历 专业' },
      makeServices({ documents: documentsMock as never })
    )
    expect(result.isError).toBe(false)
    expect(result.output).toContain('我的简历.docx')
    expect(result.output).toContain('硕士研究生')
    expect(result.references?.some((r) => r.path.includes('简历.docx'))).toBe(true)
  })

  it('read_note 对非 Markdown 材料回退到提取正文', async () => {
    const documentsMock = {
      search: () => [],
      searchByPath: () => [],
      getText: (path: string) =>
        path === '履历/简历/我的简历.docx'
          ? { title: '我的简历', text: '学历：硕士研究生（2027 届）' }
          : null
    }
    const result = await executeTool(
      'read_note',
      { path: '履历/简历/我的简历.docx' },
      makeServices({ documents: documentsMock as never })
    )
    expect(result.isError).toBe(false)
    expect(result.output).toContain('硕士研究生')
    expect(result.output).toContain('非 Markdown')
  })

  it('convert_task_to_event', async () => {
    const result = await executeTool('convert_task_to_event', { task_id: 'task-1' }, makeServices())
    expect(result.isError).toBe(false)
    expect(result.summary).toContain('转为日程')
  })

  it('get_daily_brief 输出摘要', async () => {
    const result = await executeTool('get_daily_brief', { date: '2026-10-23' }, makeServices())
    expect(result.isError).toBe(false)
    expect(result.output).toContain('2026-10-23')
    expect(result.output).toContain('晨会')
  })

  it('未知工具报错', async () => {
    const result = await executeTool('no_such_tool', {}, makeServices())
    expect(result.isError).toBe(true)
  })

  it('工具内部抛错被捕获为 isError', async () => {
    const services = makeServices()
    ;(services.calendar.createEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('网络断了')
    )
    const result = await executeTool('create_event', { title: 'x', start_at: '2026-10-24' }, services)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('网络断了')
  })
})
