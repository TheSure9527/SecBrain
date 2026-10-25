import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeProvider, OpenAIProvider, AiProviderError } from '../../src/main/ai/provider'
import type { ToolDefinition } from '../../src/main/ai/provider'

const TOOLS: ToolDefinition[] = [
  {
    name: 'create_event',
    description: '创建事件',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title']
    }
  }
]

function mockFetch(handler: (url: string, init: RequestInit) => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => handler(url, init)))
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider({
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    apiKey: 'test-key'
  })

  it('解析文本回复', async () => {
    let requestBody: Record<string, unknown> = {}
    mockFetch((_url, init) => {
      requestBody = JSON.parse(init.body as string)
      return jsonResponse({
        content: [{ type: 'text', text: '你好，主人' }],
        stop_reason: 'end_turn'
      })
    })
    const result = await provider.chat({
      system: '系统提示',
      turns: [{ role: 'user', content: '在吗' }],
      tools: TOOLS
    })
    expect(result.text).toBe('你好，主人')
    expect(result.toolCalls).toHaveLength(0)
    expect(result.stopReason).toBe('end')
    // 请求体包含 system / tools / messages
    expect(requestBody.system).toBe('系统提示')
    expect(requestBody.tools).toBeDefined()
  })

  it('解析工具调用（tool_use 块）', async () => {
    mockFetch(() =>
      jsonResponse({
        content: [
          { type: 'text', text: '好的，我来创建' },
          { type: 'tool_use', id: 'toolu_1', name: 'create_event', input: { title: '晨会' } }
        ],
        stop_reason: 'tool_use'
      })
    )
    const result = await provider.chat({
      system: 's',
      turns: [{ role: 'user', content: '明天9点创建晨会' }],
      tools: TOOLS
    })
    expect(result.stopReason).toBe('tool_use')
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'create_event', input: { title: '晨会' } }
    ])
  })

  it('多轮工具结果按 Claude 协议转换（assistant tool_use → user tool_result）', async () => {
    let requestBody: { messages: Array<Record<string, unknown>> } = { messages: [] }
    mockFetch((_url, init) => {
      requestBody = JSON.parse(init.body as string)
      return jsonResponse({ content: [{ type: 'text', text: 'done' }] })
    })
    await provider.chat({
      system: 's',
      turns: [
        { role: 'user', content: '创建事件' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'create_event', input: { title: 'x' } }] },
        { role: 'tool', results: [{ toolCallId: 'toolu_1', output: 'ok', isError: false }] }
      ],
      tools: TOOLS
    })
    const messages = requestBody.messages
    expect(messages).toHaveLength(3)
    // 第三条是 user 角色的 tool_result
    const last = messages[2] as { role: string; content: Array<{ type: string; tool_use_id: string }> }
    expect(last.role).toBe('user')
    expect(last.content[0]!.type).toBe('tool_result')
    expect(last.content[0]!.tool_use_id).toBe('toolu_1')
    // 第二条 assistant 含 tool_use 块
    const second = messages[1] as { role: string; content: Array<{ type: string }> }
    expect(second.role).toBe('assistant')
    expect(second.content.some((b) => b.type === 'tool_use')).toBe(true)
  })

  it('API 错误抛出 AiProviderError 带状态码', async () => {
    mockFetch(() => jsonResponse({ error: 'invalid api key' }, 401))
    await expect(
      provider.chat({ system: 's', turns: [{ role: 'user', content: 'x' }], tools: [] })
    ).rejects.toThrow(AiProviderError)
    try {
      mockFetch(() => jsonResponse({ error: 'invalid api key' }, 401))
      await provider.chat({ system: 's', turns: [{ role: 'user', content: 'x' }], tools: [] })
    } catch (err) {
      expect((err as AiProviderError).status).toBe(401)
    }
  })
})

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'test-key'
  })

  it('解析文本回复', async () => {
    mockFetch(() =>
      jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '你好' } }] })
    )
    const result = await provider.chat({
      system: 's',
      turns: [{ role: 'user', content: '在吗' }],
      tools: TOOLS
    })
    expect(result.text).toBe('你好')
    expect(result.stopReason).toBe('end')
  })

  it('解析工具调用（tool_calls）', async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  function: { name: 'create_event', arguments: '{"title":"晨会"}' }
                }
              ]
            }
          }
        ]
      })
    )
    const result = await provider.chat({
      system: 's',
      turns: [{ role: 'user', content: '明天9点创建晨会' }],
      tools: TOOLS
    })
    expect(result.stopReason).toBe('tool_use')
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'create_event', input: { title: '晨会' } }
    ])
  })

  it('工具参数 JSON 损坏时降级为空对象', async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              tool_calls: [{ id: 'call_1', function: { name: 'create_event', arguments: 'not json' } }]
            }
          }
        ]
      })
    )
    const result = await provider.chat({
      system: 's',
      turns: [{ role: 'user', content: 'x' }],
      tools: TOOLS
    })
    expect(result.toolCalls[0]!.input).toEqual({})
  })

  it('多轮工具结果按 OpenAI 协议转换（tool 角色消息）', async () => {
    let requestBody: { messages: Array<{ role: string }> } = { messages: [] }
    mockFetch((_url, init) => {
      requestBody = JSON.parse(init.body as string)
      return jsonResponse({ choices: [{ message: { content: 'done' } }] })
    })
    await provider.chat({
      system: 's',
      turns: [
        { role: 'user', content: '创建事件' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'create_event', input: { title: 'x' } }] },
        { role: 'tool', results: [{ toolCallId: 'call_1', output: 'ok', isError: false }] }
      ],
      tools: TOOLS
    })
    // system + user + assistant(tool_calls) + tool
    expect(requestBody.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
  })

  it('API 错误抛出 AiProviderError', async () => {
    mockFetch(() => jsonResponse({ error: 'rate limited' }, 429))
    await expect(
      provider.chat({ system: 's', turns: [{ role: 'user', content: 'x' }], tools: [] })
    ).rejects.toThrow(AiProviderError)
  })

  it('自定义 baseUrl 用于拼接端点（DeepSeek 等兼容服务）', async () => {
    const deepseek = new OpenAIProvider({
      provider: 'openai',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com'
    })
    let requestedUrl = ''
    mockFetch((url) => {
      requestedUrl = url
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    await deepseek.chat({ system: 's', turns: [{ role: 'user', content: 'x' }], tools: [] })
    expect(requestedUrl).toBe('https://api.deepseek.com/chat/completions')
  })

  it('baseUrl 带尾部斜杠时正确拼接', async () => {
    const custom = new OpenAIProvider({
      provider: 'openai',
      model: 'm',
      apiKey: 'k',
      baseUrl: 'https://gateway.example.com/v1/'
    })
    let requestedUrl = ''
    mockFetch((url) => {
      requestedUrl = url
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    await custom.chat({ system: 's', turns: [{ role: 'user', content: 'x' }], tools: [] })
    expect(requestedUrl).toBe('https://gateway.example.com/v1/chat/completions')
  })

  it('未提供 baseUrl 时回退官方地址', async () => {
    let requestedUrl = ''
    mockFetch((url) => {
      requestedUrl = url
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    await provider.chat({ system: 's', turns: [{ role: 'user', content: 'x' }], tools: [] })
    expect(requestedUrl).toBe('https://api.openai.com/v1/chat/completions')
  })
})
