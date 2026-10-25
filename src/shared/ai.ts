/**
 * AI 管家模块的共享类型（主进程 / preload / 渲染层共用）。
 */

/** claude = Anthropic 原生协议；openai = OpenAI 兼容协议（含 DeepSeek 等） */
export type AiProviderId = 'claude' | 'openai'

export interface AiProviderConfig {
  provider: AiProviderId
  model: string
  apiKey: string
  /** OpenAI 兼容服务的 base URL（openai provider 必填，claude 忽略） */
  baseUrl?: string
}

/** 回给前端的配置（不含 Key 明文） */
export interface AiConfigView {
  provider: AiProviderId
  model: string
  hasKey: boolean
  defaultModel: string
  baseUrl: string
  /** 未配置大模型时由本地规则引擎兜底 */
  localMode: boolean
  /** 已保存的 Key 无法解密时的原因（换机 / 应用改名后可能出现） */
  keyError?: string | null
}

/** OpenAI 兼容服务预设（渲染层设置页使用） */
export interface AiPreset {
  id: string
  label: string
  baseUrl: string
  /** 默认模型（切换服务时自动选中） */
  model: string
  /** 该服务下的可选模型列表 */
  models: string[]
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o-mini', 'o4-mini']
  },
  {
    id: 'ollama',
    label: 'Ollama（本地运行，无需 API Key）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen2.5:3b', 'qwen3:8b', 'llama3.1:8b', 'gemma3:4b']
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本地运行，无需 API Key）',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    models: []
  },
  {
    id: 'gemini',
    label: 'Google Gemini（OpenAI 兼容端点）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen3-max', 'qwen-plus', 'qwen-flash', 'qwen-long']
  },
  {
    id: 'kimi',
    label: 'Kimi（ Moonshot ）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-0905-preview',
    models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'moonshot-v1-128k']
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.6',
    models: ['glm-4.6', 'glm-4-plus', 'glm-4-flash']
  }
]

/** Claude 可选模型 */
export const CLAUDE_MODELS = [
  'claude-sonnet-4-5',
  'claude-opus-4-1',
  'claude-haiku-4-5',
  'claude-3-7-sonnet'
]

export interface AiConfigApi {
  getConfig(): Promise<AiConfigView>
  saveConfig(config: AiProviderConfig): Promise<AiConfigView>
  testConnection(): Promise<{ ok: boolean; error: string | null }>
  /** 用当前 Key 拉取服务端真实可用的模型列表 */
  listModels(): Promise<{ models: string[]; error: string | null }>
  /** 探测本机常见本地模型服务（Ollama / LM Studio / llama.cpp） */
  probeLocal(): Promise<ProbeLocalResult>
}

export interface ProbeLocalResult {
  found: boolean
  name?: string
  baseUrl?: string
  models: string[]
  error?: string
  /** 每个候选端口的探测结果（便于界面展示"为什么没找到"） */
  attempts?: Array<{ name: string; url: string; error: string | null }>
}

/** 一次工具调用的记录（用于界面展示） */
export interface ToolCallRecord {
  name: string
  summary: string
  ok: boolean
}

export interface ButlerChatInput {
  text: string
  /** 会话隔离键（默认 desktop；渠道消息为 channel:conversationId:userId） */
  sessionId?: string
}

export interface ButlerReference {
  path: string
  title: string
}

export interface ButlerReply {
  text: string
  toolCalls: ToolCallRecord[]
  /** 回答引用的笔记（点击可打开） */
  references: ButlerReference[]
}

export interface ButlerMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

/** 供 UI 展示的上下文长度选项（历史消息条数） */
export const BUTLER_CONTEXT_OPTIONS = [
  { value: 0, label: '仅本轮（不带历史）' },
  { value: 6, label: '6 条消息（约 3 轮）' },
  { value: 10, label: '10 条消息（约 5 轮，默认）' },
  { value: 20, label: '20 条消息（约 10 轮）' },
  { value: 40, label: '40 条消息（最长）' }
] as const

export const DEFAULT_BUTLER_CONTEXT_LIMIT = 10

export interface ButlerApi extends AiConfigApi {
  chat(input: ButlerChatInput): Promise<ButlerReply>
  history(sessionId?: string): Promise<ButlerMessage[]>
  clearHistory(sessionId?: string): Promise<void>
  /** 读取回放给模型的历史消息条数 */
  getContextLimit(): Promise<number>
  setContextLimit(limit: number): Promise<number>
}
