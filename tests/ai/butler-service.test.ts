import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

// electron 的 safeStorage 在测试环境用内存替身
vi.mock('electron', () => ({
  safeStorage: {
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

// Provider 工厂 mock：返回可控的假 provider
const chatMock = vi.fn()
vi.mock('../../src/main/ai/provider', () => ({
  DEFAULT_MODELS: { claude: 'claude-sonnet-4-5', openai: 'gpt-4o-mini' },
  DEFAULT_BASE_URLS: { claude: 'https://api.anthropic.com', openai: 'https://api.openai.com/v1' },
  createProvider: vi.fn(() => ({ chat: chatMock })),
  AiProviderError: class AiProviderError extends Error {}
}))

import { applySchema } from '../../src/main/db/schema'
import { ButlerService } from '../../src/main/ai/butler-service'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let service: ButlerService
const createEventMock = vi.fn()

function makeServices(): ConstructorParameters<typeof ButlerService>[1] {
  return {
    calendar: {
      listCalendars: () => [
        { id: 'local', url: 'local://', displayName: '本地日历', color: '#888', source: 'local' as const }
      ],
      getEvents: () => [],
      createEvent: createEventMock,
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      notify: () => {},
      notifyReminder: () => {}
    } as never,
    tasks: {
      list: () => [],
      counts: () => ({ today: 0, week: 0, all: 0, done: 0 }),
      create: vi.fn(),
      update: vi.fn(),
      complete: vi.fn((id: string, done: boolean) => ({ id, title: `任务 ${id}`, status: done ? 'done' : 'todo' })),
      delete: vi.fn(),
      convertToEvent: vi.fn(),
      notifyDue: () => {}
    } as never,
    notes: {
      searchNotes: () => [],
      listNotes: () => [],
      readNote: async () => null,
      createNote: async () => ({}) as never,
      updateNote: async () => ({}) as never,
      deleteNote: async () => {},
      saveAttachment: async () => ({}) as never,
      init: async () => {},
      dispose: () => {}
    } as never
  }
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  chatMock.mockReset()
  createEventMock.mockReset()
  createEventMock.mockImplementation(async (input) => ({
    id: 'local::new',
    uid: 'new',
    calendarId: 'local',
    title: input.title,
    description: '',
    location: '',
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: input.allDay ?? false,
    rrule: null,
    reminderMinutes: null,
    color: '#888',
    isOccurrence: false
  }))
  service = new ButlerService(db, makeServices())
})

afterEach(() => db.close())

describe('ButlerService 上下文长度', () => {
  it('默认回放 10 条历史消息', () => {
    expect(service.getContextLimit()).toBe(10)
  })

  it('可设置为 0（不带历史）并持久化', async () => {
    for (let i = 0; i < 3; i += 1) {
      // 造几条历史
      db.prepare("INSERT INTO ai_messages (role, content, created_at) VALUES ('user', ?, ?)").run(
        `历史${i}`,
        new Date().toISOString()
      )
    }
    expect(service.setContextLimit(0)).toBe(0)
    service.saveConfig({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })

    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [] })
    await service.chat('当前问题')
    const turns = (chatMock.mock.calls[0]![0] as { turns: Array<{ role: string; content: string }> }).turns
    expect(turns).toHaveLength(1)
    expect(turns[0]!.content).toContain('当前问题')

    // 新实例仍保持设置
    const another = new ButlerService(db, makeServices())
    expect(another.getContextLimit()).toBe(0)
  })

  it('设置值被收敛到 0..40', () => {
    expect(service.setContextLimit(100)).toBe(40)
    expect(service.setContextLimit(-5)).toBe(0)
    expect(service.setContextLimit(12)).toBe(12)
  })

  it('设为 20 时最多回放 20 条历史', async () => {
    for (let i = 0; i < 30; i += 1) {
      db.prepare("INSERT INTO ai_messages (role, content, created_at) VALUES ('user', ?, ?)").run(
        `历史${i}`,
        new Date().toISOString()
      )
    }
    service.setContextLimit(20)
    service.saveConfig({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })
    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [] })
    await service.chat('新问题')
    const turns = (chatMock.mock.calls[0]![0] as { turns: unknown[] }).turns
    // 20 条历史 + 当前 1 条
    expect(turns).toHaveLength(21)
  })
})

describe('ButlerService 知识库上下文', () => {
  it('系统提示包含知识库概况与预检索摘录，且不残留高亮标签', async () => {
    const notesMock = {
      searchNotes: (query: string) =>
        query.includes('时间管理')
          ? [{ path: '读书/时间管理.md', title: '时间管理', snippet: '<mark>番茄工作法</mark>很有效' }]
          : [],
      listNotes: () => [
        {
          path: '读书/时间管理.md',
          title: '时间管理',
          tags: ['读书'],
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z'
        }
      ],
      readNote: async () => null,
      graph: () => ({ nodes: [], edges: [] }),
      backlinks: () => []
    }
    const svc = new ButlerService(db, { ...makeServices(), notes: notesMock as never })
    svc.saveConfig({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })
    chatMock.mockResolvedValue({ text: '好的', toolCalls: [] })
    await svc.chat('帮我总结一下时间管理的方法')

    const request = chatMock.mock.calls[0]![0] as { system: string; turns: Array<{ role: string; content: string }> }
    const system = String(request.system)
    expect(system).toContain('知识库概况')
    expect(system).toContain('时间管理')

    // 检索摘录现在注入到本轮用户消息，模型更难忽略
    const userTurn = request.turns.filter((turn) => turn.role === 'user').at(-1)!
    expect(userTurn.content).toContain('番茄工作法')
    expect(userTurn.content).toContain('本轮自动检索')
    expect(userTurn.content).not.toContain('<mark>')
  })
})

describe('ButlerService 会话隔离', () => {
  it('不同会话的历史互不串联', async () => {
    service.saveConfig({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })
    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [] })

    await service.chat('会话A的消息', 'dingtalk:c1:u1')
    await service.chat('会话B的消息', 'dingtalk:c2:u2')

    const secondTurns = (chatMock.mock.calls[1]![0] as { turns: Array<{ content: string }> }).turns
      .map((turn) => turn.content)
      .join('\n')
    expect(secondTurns).not.toContain('会话A的消息')
    expect(secondTurns).toContain('会话B的消息')

    expect(service.history('dingtalk:c1:u1')).toHaveLength(2)
    expect(service.history('dingtalk:c2:u2')).toHaveLength(2)
    // 桌面会话不受影响
    expect(service.history()).toHaveLength(0)
  })

  it('可按会话清空历史', async () => {
    service.saveConfig({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })
    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [] })
    await service.chat('A', 'dingtalk:c1:u1')
    await service.chat('B', 'dingtalk:c2:u2')

    service.clearHistory('dingtalk:c1:u1')
    expect(service.history('dingtalk:c1:u1')).toHaveLength(0)
    expect(service.history('dingtalk:c2:u2')).toHaveLength(2)
  })
})

describe('检索日志', () => {
  it('每次提问都会落一条 retrieval_log', async () => {
    service.saveConfig({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })
    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [] })
    await service.chat('我是什么专业的学生', 'dingtalk:c9:u9')

    const row = db.prepare('SELECT COUNT(*) AS c FROM retrieval_log').get() as { c: number }
    expect(row.c).toBeGreaterThan(0)
    const last = db
      .prepare('SELECT session_id, query, terms, latency_ms FROM retrieval_log ORDER BY id DESC LIMIT 1')
      .get() as { session_id: string; query: string; terms: string; latency_ms: number }
    expect(last.session_id).toBe('dingtalk:c9:u9')
    expect(last.query).toBe('我是什么专业的学生')
    expect(JSON.parse(last.terms)).toEqual(expect.arrayContaining(['专业', '学生']))
    expect(last.latency_ms).toBeGreaterThanOrEqual(0)
  })
})

describe('ButlerService 配置', () => {
  it('初始无配置', () => {
    const config = service.getConfig()
    expect(config.hasKey).toBe(false)
    expect(config.provider).toBe('claude')
  })

  it('保存配置后 hasKey 为 true 且 provider 生效', () => {
    const config = service.saveConfig({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1'
    })
    expect(config.hasKey).toBe(true)
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o-mini')
    expect(config.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('空 Key 且无已存 Key 时抛错', () => {
    expect(() => service.saveConfig({ provider: 'claude', model: 'm', apiKey: '' })).toThrow()
  })

  it('Key 留空时沿用已存 Key（只改模型）', () => {
    service.saveConfig({
      provider: 'openai',
      model: 'deepseek-chat',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com'
    })
    const config = service.saveConfig({
      provider: 'openai',
      model: 'deepseek-reasoner',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com'
    })
    expect(config.model).toBe('deepseek-reasoner')
    expect(config.hasKey).toBe(true)
  })

  it('重启后从 meta 恢复配置', () => {
    service.saveConfig({ provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-test' })
    const restored = new ButlerService(db, makeServices())
    expect(restored.getConfig().hasKey).toBe(true)
    expect(restored.getConfig().model).toBe('claude-sonnet-4-5')
  })

  it('OpenAI 兼容服务必须提供 baseUrl', () => {
    expect(() => service.saveConfig({ provider: 'openai', model: 'm', apiKey: 'sk' })).toThrow(
      'Base URL'
    )
  })

  it('DeepSeek 配置持久化并在重启后恢复', () => {
    service.saveConfig({
      provider: 'openai',
      model: 'deepseek-chat',
      apiKey: 'sk-ds',
      baseUrl: 'https://api.deepseek.com'
    })
    const config = service.getConfig()
    expect(config.baseUrl).toBe('https://api.deepseek.com')

    const restored = new ButlerService(db, makeServices())
    const restoredConfig = restored.getConfig()
    expect(restoredConfig.provider).toBe('openai')
    expect(restoredConfig.model).toBe('deepseek-chat')
    expect(restoredConfig.baseUrl).toBe('https://api.deepseek.com')
    expect(restoredConfig.hasKey).toBe(true)
  })
})

describe('ButlerService 对话', () => {
  beforeEach(() => {
    service.saveConfig({ provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-test' })
  })

  it('未配置时走本地规则模式，而不是报错', async () => {
    service.clearConfig()
    const reply = await service.chat('在吗')
    expect(reply.text).toContain('本地规则模式')
    expect(reply.toolCalls[0]?.name).toBe('local.search')
  })

  it('纯文本回复：直接返回并持久化历史', async () => {
    chatMock.mockResolvedValue({ text: '你好，主人', toolCalls: [], stopReason: 'end' })
    const reply = await service.chat('在吗')
    expect(reply.text).toBe('你好，主人')
    expect(reply.toolCalls).toHaveLength(0)

    const history = service.history()
    expect(history).toHaveLength(2)
    expect(history[0]!.role).toBe('user')
    expect(history[0]!.content).toBe('在吗')
    expect(history[1]!.role).toBe('assistant')
    expect(history[1]!.content).toBe('你好，主人')
  })

  it('工具调用：执行后回填结果，最终返回文本', async () => {
    chatMock
      .mockResolvedValueOnce({
        text: '好的，我来创建',
        toolCalls: [{ id: 'toolu_1', name: 'create_event', input: { title: '给妈妈打电话', start_at: '明天下午3点' } }],
        stopReason: 'tool_use'
      })
      .mockResolvedValueOnce({ text: '已安排好明天下午3点给妈妈打电话', toolCalls: [], stopReason: 'end' })

    const reply = await service.chat('明天下午3点提醒我给妈妈打电话')
    expect(reply.text).toBe('已安排好明天下午3点给妈妈打电话')
    expect(reply.toolCalls).toHaveLength(1)
    expect(reply.toolCalls[0]!.name).toBe('create_event')
    expect(reply.toolCalls[0]!.ok).toBe(true)

    // 工具真正执行了（时间被归一化）
    expect(createEventMock).toHaveBeenCalledTimes(1)
    const input = createEventMock.mock.calls[0]![0] as { startAt: string }
    expect(new Date(input.startAt).getHours()).toBe(15)

    // 第二轮请求带上了工具结果（user 角色 tool_result）
    const secondCall = chatMock.mock.calls[1]![0] as { turns: Array<{ role: string }> }
    expect(secondCall.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'tool'])
  })

  it('多轮工具调用：两轮全部执行', async () => {
    chatMock
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'create_event', input: { title: '事件A', start_at: '2026-10-24T10:00:00+08:00' } }],
        stopReason: 'tool_use'
      })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't2', name: 'create_task', input: { title: '任务B' } }],
        stopReason: 'tool_use'
      })
      .mockResolvedValueOnce({ text: '两件事都办好了', toolCalls: [], stopReason: 'end' })

    const reply = await service.chat('创建事件A和任务B')
    expect(reply.text).toBe('两件事都办好了')
    expect(reply.toolCalls).toHaveLength(2)
    expect(createEventMock).toHaveBeenCalledTimes(1)
  })

  it('工具执行失败也记录并继续', async () => {
    createEventMock.mockRejectedValue(new Error('日历未连接'))
    chatMock
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 't1', name: 'create_event', input: { title: 'x', start_at: '2026-10-24' } }],
        stopReason: 'tool_use'
      })
      .mockResolvedValueOnce({ text: '创建失败了', toolCalls: [], stopReason: 'end' })

    const reply = await service.chat('创建事件')
    expect(reply.toolCalls[0]!.ok).toBe(false)
    expect(reply.text).toBe('创建失败了')
  })

  it('达到工具轮数上限时用工具结果兜底', async () => {
    chatMock.mockResolvedValue({
      text: '',
      toolCalls: [{ id: 't1', name: 'create_event', input: { title: 'x', start_at: '2026-10-24' } }],
      stopReason: 'tool_use'
    })
    const reply = await service.chat('一直创建')
    expect(chatMock).toHaveBeenCalledTimes(5)
    expect(reply.toolCalls).toHaveLength(5)
    expect(reply.text).toContain('已完成')
  })

  it('clearHistory 清空历史', async () => {
    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [], stopReason: 'end' })
    await service.chat('在吗')
    expect(service.history().length).toBeGreaterThan(0)
    service.clearHistory()
    expect(service.history()).toHaveLength(0)
  })

  it('历史进入下一轮请求的上下文', async () => {
    chatMock.mockResolvedValue({ text: 'ok', toolCalls: [], stopReason: 'end' })
    await service.chat('第一句话')
    chatMock.mockClear()
    chatMock.mockResolvedValue({ text: 'second', toolCalls: [], stopReason: 'end' })
    await service.chat('第二句话')
    const turns = (chatMock.mock.calls[0]![0] as { turns: Array<{ role: string; content: string }> }).turns
    // user, assistant(历史), user(当前)
    expect(turns.map((t) => t.content)).toContain('第一句话')
    expect(turns.map((t) => t.content)).toContain('第二句话')
  })
})
