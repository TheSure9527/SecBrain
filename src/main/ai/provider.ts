import type { AiProviderConfig, AiProviderId } from '../../shared/ai'

/** 归一化的工具定义（与 Provider 无关） */
export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema（对象） */
  inputSchema: Record<string, unknown>
}

/** 归一化的模型工具调用请求 */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/** 归一化的对话轮次（支持多轮工具调用） */
export type ChatTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; results: Array<{ toolCallId: string; output: string; isError: boolean }> }

export interface AiChatResult {
  text: string
  toolCalls: ToolCall[]
  /** 'end' = 正常结束；'tool_use' = 请求执行工具 */
  stopReason: 'end' | 'tool_use'
}

export interface AiProvider {
  readonly id: AiProviderId
  /** 拉取该 Key 实际可用的模型列表（各家的 /models 接口） */
  listModels(): Promise<string[]>
  chat(params: {
    system: string
    turns: ChatTurn[]
    tools: ToolDefinition[]
    maxTokens?: number
  }): Promise<AiChatResult>
}

export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  claude: 'claude-sonnet-4-5',
  openai: 'gpt-4o-mini'
}

export const DEFAULT_BASE_URLS: Record<AiProviderId, string> = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1'
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

// ---------------------------------------------------------------------------
// Claude（Anthropic Messages API）
// ---------------------------------------------------------------------------

interface ClaudeContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

export class ClaudeProvider implements AiProvider {
  readonly id = 'claude' as const

  constructor(private readonly config: AiProviderConfig) {}

  async listModels(): Promise<string[]> {
    const base = (this.config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    const response = await fetch(`${base}/v1/models?limit=100`, {
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      }
    })
    if (!response.ok) {
      throw new AiProviderError(`读取模型列表失败（HTTP ${response.status}）`, response.status)
    }
    const data = (await response.json()) as { data?: Array<{ id?: string }> }
    return (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
      .sort()
  }

  async chat({
    system,
    turns,
    tools,
    maxTokens = 4096
  }: Parameters<AiProvider['chat']>[0]): Promise<AiChatResult> {
    const messages = turns.map(toClaudeMessages).flat()

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: maxTokens,
      system,
      messages
    }
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }))
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const detail = await safeErrorText(response)
      throw new AiProviderError(`Claude API 错误 (${response.status}): ${detail}`, response.status)
    }

    const data = (await response.json()) as {
      content?: ClaudeContentBlock[]
      stop_reason?: string
    }
    const blocks = data.content ?? []
    const text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n')
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === 'tool_use' && b.id && b.name)
      .map((b) => ({
        id: b.id!,
        name: b.name!,
        input: (b.input ?? {}) as Record<string, unknown>
      }))

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end'
    }
  }
}

function toClaudeMessages(turn: ChatTurn): Array<Record<string, unknown>> {
  if (turn.role === 'user') {
    return [{ role: 'user', content: turn.content }]
  }
  if (turn.role === 'assistant') {
    const content: ClaudeContentBlock[] = []
    if (turn.content) content.push({ type: 'text', text: turn.content })
    for (const call of turn.toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    return [{ role: 'assistant', content }]
  }
  // tool results → Claude 用 user 角色的 tool_result 块
  return [
    {
      role: 'user',
      content: turn.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.toolCallId,
        content: r.output,
        is_error: r.isError
      }))
    }
  ]
}

// ---------------------------------------------------------------------------
// OpenAI（Chat Completions API）
// ---------------------------------------------------------------------------

export class OpenAIProvider implements AiProvider {
  readonly id = 'openai' as const

  constructor(private readonly config: AiProviderConfig) {}

  /** OpenAI 兼容端点：baseUrl + /chat/completions（自动处理尾部斜杠） */
  private endpoint(): string {
    const base = (this.config.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/+$/, '')
    return `${base}/chat/completions`
  }

  async listModels(): Promise<string[]> {
    const base = (this.config.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/+$/, '')
    const response = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${this.config.apiKey}` }
    })
    if (!response.ok) {
      throw new AiProviderError(`读取模型列表失败（HTTP ${response.status}）`, response.status)
    }
    const data = (await response.json()) as { data?: Array<{ id?: string }> }
    return (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
      .sort()
  }

  async chat({
    system,
    turns,
    tools,
    maxTokens = 4096
  }: Parameters<AiProvider['chat']>[0]): Promise<AiChatResult> {
    const messages: Array<Record<string, unknown>> = [{ role: 'system', content: system }]
    for (const turn of turns) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.content })
      } else if (turn.role === 'assistant') {
        const msg: Record<string, unknown> = { role: 'assistant', content: turn.content || null }
        if (turn.toolCalls.length > 0) {
          msg.tool_calls = turn.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.input) }
          }))
        }
        messages.push(msg)
      } else {
        for (const result of turn.results) {
          messages.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content: result.output
          })
        }
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: maxTokens,
      messages
    }
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
    }

    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const detail = await safeErrorText(response)
      throw new AiProviderError(`OpenAI API 错误 (${response.status}): ${detail}`, response.status)
    }

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>
    }
    const message = data.choices?.[0]?.message
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      input: parseJsonSafe(call.function.arguments)
    }))

    return {
      text: message?.content ?? '',
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end'
    }
  }
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 300)
  } catch {
    return response.statusText
  }
}

export function createProvider(config: AiProviderConfig): AiProvider {
  return config.provider === 'openai' ? new OpenAIProvider(config) : new ClaudeProvider(config)
}
