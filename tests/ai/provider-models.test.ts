import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProvider } from '../../src/main/ai/provider'
import type { AiProviderConfig } from '../../src/shared/ai'

const baseConfig: AiProviderConfig = {
  provider: 'openai',
  model: 'deepseek-chat',
  apiKey: 'sk-test',
  baseUrl: 'https://api.deepseek.com'
}

function stubFetch(json: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => ({
    ok,
    status,
    json: async () => json
  }) as Response)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => vi.unstubAllGlobals())

describe('模型列表 /models', () => {
  it('OpenAI 兼容端点：解析 data[].id 并排序', async () => {
    const mock = stubFetch({ data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] })
    const models = await createProvider(baseConfig).listModels()
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    const [url, init] = mock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://api.deepseek.com/models')
    expect(init.headers.authorization).toBe('Bearer sk-test')
  })

  it('baseUrl 带尾部斜杠也不会拼出双斜杠', async () => {
    const mock = stubFetch({ data: [] })
    await createProvider({ ...baseConfig, baseUrl: 'https://api.openai.com/v1/' }).listModels()
    expect((mock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.openai.com/v1/models')
  })

  it('Claude：走 /v1/models 并带 anthropic-version', async () => {
    const mock = stubFetch({ data: [{ id: 'claude-sonnet-4-5' }] })
    const models = await createProvider({ ...baseConfig, provider: 'claude', baseUrl: '' }).listModels()
    expect(models).toEqual(['claude-sonnet-4-5'])
    const [url, init] = mock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toContain('api.anthropic.com/v1/models')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    expect(init.headers['x-api-key']).toBe('sk-test')
  })

  it('HTTP 失败给出可读错误（含状态码）', async () => {
    stubFetch({}, false, 401)
    await expect(createProvider(baseConfig).listModels()).rejects.toThrow(/401/)
  })

  it('返回体缺少 data 时为空数组', async () => {
    stubFetch({})
    expect(await createProvider(baseConfig).listModels()).toEqual([])
  })
})
