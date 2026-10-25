import { safeStorage } from 'electron'
import type {
  AiConfigView,
  AiProviderConfig,
  AiProviderId,
  ButlerMessage,
  ButlerReply
} from '../../shared/ai'
import type { DatabaseSync } from 'node:sqlite'
import type { CalendarService } from '../calendar'
import type { TaskService } from '../tasks'
import type { NotesService } from '../vault'
import type { SemanticService } from '../semantic'
import type { DocumentIndexer } from '../indexer'
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  createProvider,
  type AiProvider,
  type ChatTurn,
  type ToolCall
} from './provider'
import { stripHighlight } from './search'
import { hybridSearch, type SearchTrace } from './hybrid-search'
import { buildKnowledgeOverview, extractSearchTerms } from './retrieval'
import { TOOL_DEFINITIONS, executeTool, type ToolServices } from './tools'
import { LocalEngine } from './local-engine'

const KEY_PROVIDER = 'ai.provider'
const KEY_MODEL = 'ai.model'
const KEY_API_KEY_ENC = 'ai.apiKey.enc'
const KEY_BASE_URL = 'ai.baseUrl'

const MAX_TOOL_ROUNDS = 5
const MAX_HISTORY = 40
const KEY_CONTEXT_LIMIT = 'ai.contextLimit'
const DEFAULT_CONTEXT_LIMIT = 10
const DEFAULT_SESSION = 'desktop'

interface AiMessageRow {
  id: number
  role: string
  content: string
  created_at: string
}

/**
 * AI 管家：对话编排 + 工具调用循环 + 历史持久化。
 * Provider / Key 配置存 meta 表（Key 经 safeStorage 加密）。
 */
export class ButlerService {
  private provider: AiProvider | null = null
  private keyError: string | null = null
  private readonly local: LocalEngine
  private config: { provider: AiProviderId; model: string; apiKey: string; baseUrl?: string } | null =
    null

  constructor(
    private readonly db: DatabaseSync,
    private readonly services: {
      calendar: CalendarService
      tasks: TaskService
      notes: NotesService
      semantic?: SemanticService | null
      documents?: DocumentIndexer | null
    }
  ) {
    this.local = new LocalEngine(services)
    this.restoreConfig()
  }

  // ---------- 配置 ----------

  private restoreConfig(): void {
    const provider = this.getMeta(KEY_PROVIDER) as AiProviderId | null
    const model = this.getMeta(KEY_MODEL)
    const keyEnc = this.getMeta(KEY_API_KEY_ENC)
    const baseUrl = this.getMeta(KEY_BASE_URL)
    if (!provider || !model || !keyEnc) return
    try {
      const apiKey = safeStorage.decryptString(Buffer.from(keyEnc, 'base64'))
      this.keyError = null
      this.setProvider({ provider, model, apiKey, baseUrl: baseUrl ?? undefined })
    } catch {
      // 换机 / 应用改名后钥匙串密钥变化，旧密文无法解密
      this.keyError = '已保存的 API Key 无法解密（应用改名或换机后可能出现），请重新填写'
    }
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  }

  private setProvider(config: AiProviderConfig): void {
    this.config = {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    }
    this.provider = createProvider(config)
  }

  getConfig(): AiConfigView {
    return {
      provider: this.config?.provider ?? 'claude',
      model: this.config?.model ?? DEFAULT_MODELS.claude,
      hasKey: !!this.config?.apiKey,
      defaultModel: DEFAULT_MODELS[this.config?.provider ?? 'claude'],
      baseUrl: this.config?.baseUrl ?? DEFAULT_BASE_URLS[this.config?.provider ?? 'claude'],
      localMode: !this.config?.apiKey,
      keyError: this.keyError
    }
  }

  saveConfig(config: AiProviderConfig): AiConfigView {
    const apiKey = config.apiKey.trim()
    const existingKey = this.config?.apiKey
    /** 本地服务（Ollama / LM Studio / llama.cpp）不需要 API Key */
    const isLocalEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/i.test(
      config.baseUrl?.trim() ?? ''
    )
    if (!apiKey && !existingKey && !isLocalEndpoint) {
      throw new Error('API Key 不能为空（本地模型如 Ollama 可留空）')
    }
    if (config.provider === 'openai' && !config.baseUrl?.trim() && !this.config?.baseUrl) {
      throw new Error('OpenAI 兼容服务需要填写 Base URL')
    }
    // 允许只修改 Provider/模型：Key 留空时沿用已保存的 Key
    this.setProvider({
      provider: config.provider,
      model: config.model,
      apiKey: apiKey || existingKey || '',
      baseUrl: config.baseUrl?.trim() || this.config?.baseUrl
    })
    this.setMeta(KEY_PROVIDER, config.provider)
    this.setMeta(KEY_MODEL, config.model)
    if (this.config?.baseUrl) this.setMeta(KEY_BASE_URL, this.config.baseUrl)
    if (apiKey) {
      this.setMeta(KEY_API_KEY_ENC, safeStorage.encryptString(apiKey).toString('base64'))
    }
    return this.getConfig()
  }

  clearConfig(): void {
    this.config = null
    this.provider = null
    this.deleteMeta(KEY_PROVIDER)
    this.deleteMeta(KEY_MODEL)
    this.deleteMeta(KEY_API_KEY_ENC)
    this.deleteMeta(KEY_BASE_URL)
  }

  /** 用最小请求验证 Key 可用性 */
  /** 探测本机本地模型服务（不需要任何 Key） */
  async probeLocal(): Promise<{
    found: boolean
    name?: string
    baseUrl?: string
    models: string[]
    error?: string
    attempts?: Array<{ name: string; url: string; error: string | null }>
  }> {
    const candidates = [
      { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
      { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
      { name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' }
    ]
    const errors: string[] = []
    const attempts: Array<{ name: string; url: string; error: string | null }> = []
    for (const candidate of candidates) {
      try {
        const response = await fetch(`${candidate.baseUrl}/models`, {
          signal: AbortSignal.timeout(800)
        })
        if (!response.ok) {
          errors.push(`${candidate.name}: HTTP ${response.status}`)
          attempts.push({ name: candidate.name, url: candidate.baseUrl, error: `HTTP ${response.status}` })
          continue
        }
        const data = (await response.json()) as { data?: Array<{ id?: string }> }
        const models = (data.data ?? [])
          .map((item) => item.id)
          .filter((id): id is string => typeof id === 'string')
        if (models.length === 0) {
          errors.push(`${candidate.name}: 无可用模型`)
          attempts.push({ name: candidate.name, url: candidate.baseUrl, error: '无可用模型（先 ollama pull 一个）' })
          continue
        }
        attempts.push({ name: candidate.name, url: candidate.baseUrl, error: null })
        return { found: true, name: candidate.name, baseUrl: candidate.baseUrl, models, attempts }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`${candidate.name}: ${message}`)
        attempts.push({ name: candidate.name, url: candidate.baseUrl, error: '连接失败（服务未启动）' })
      }
    }
    return {
      found: false,
      models: [],
      error: errors.join('；') || '未发现本地模型服务',
      attempts
    }
  }

  /** 用当前 Key 拉取真实可用的模型列表 */
  async listModels(): Promise<{ models: string[]; error: string | null }> {
    if (!this.provider) return { models: [], error: '尚未配置 AI' }
    try {
      const models = await this.provider.listModels()
      return { models, error: null }
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  async testConnection(): Promise<{ ok: boolean; error: string | null }> {
    if (!this.provider) return { ok: false, error: '尚未配置 AI（当前使用本地规则模式）' }
    try {
      const result = await this.provider.chat({
        system: '你是连通性测试助手，请原样回复：OK',
        turns: [{ role: 'user', content: 'ping' }],
        tools: [],
        maxTokens: 16
      })
      return { ok: result.text.length >= 0, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ---------- 对话 ----------

  history(sessionId = DEFAULT_SESSION): ButlerMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, role, content, created_at FROM ai_messages
         WHERE session_id = ? ORDER BY id DESC LIMIT ?`
      )
      .all(sessionId, MAX_HISTORY) as unknown as AiMessageRow[]
    return rows.reverse().map((r) => ({
      id: r.id,
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: r.content,
      createdAt: r.created_at
    }))
  }

  clearHistory(sessionId = DEFAULT_SESSION): void {
    this.db.prepare('DELETE FROM ai_messages WHERE session_id = ?').run(sessionId)
  }

  private persist(role: 'user' | 'assistant', content: string, sessionId: string): void {
    this.db
      .prepare(
        'INSERT INTO ai_messages (role, content, created_at, session_id) VALUES (?, ?, ?, ?)'
      )
      .run(role, content, new Date().toISOString(), sessionId)
  }

  async chat(text: string, sessionId = DEFAULT_SESSION): Promise<ButlerReply> {
    // 未配置大模型时走本地规则引擎（完全离线，覆盖日程/待办/记笔记/检索）
    if (!this.provider) {
      const reply = await this.local.reply(text)
      this.persist('user', text, sessionId)
      this.persist('assistant', reply.text, sessionId)
      return reply
    }

    const toolRecords: ButlerReply['toolCalls'] = []
    const references = new Map<string, { path: string; title: string }>()

    // 预检索：把检索到的原文直接挂到本轮用户消息里（比只放 system 更不易被忽略）
    const preRetrieval = await this.buildPreRetrievalContext(text, sessionId)
    const userContent = preRetrieval.text
      ? `${text}\n\n---\n【本轮自动检索到的知识库资料，请优先据此回答并标注来源；若与历史结论冲突，以本段为准】\n${preRetrieval.text}`
      : text
    for (const reference of preRetrieval.references) {
      references.set(reference.path, reference)
    }

    // 先构建上下文（历史 + 当前输入），再落库，避免当前消息在历史里重复出现
    let turns: ChatTurn[] = [
      ...this.historyTurns(sessionId),
      { role: 'user' as const, content: userContent }
    ]
    this.persist('user', text, sessionId)

    let finalText = ''
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await this.provider.chat({
        system: this.buildSystemPrompt(),
        turns,
        tools: TOOL_DEFINITIONS
      })

      if (result.toolCalls.length === 0) {
        finalText = result.text
        break
      }

      // 执行全部工具调用，结果回填给模型
      const results: Array<{ toolCallId: string; output: string; isError: boolean }> = []
      for (const call of result.toolCalls) {
        const execution = await executeTool(call.name, call.input, this.toolServices())
        results.push({
          toolCallId: call.id,
          output: execution.output,
          isError: execution.isError
        })
        toolRecords.push({
          name: call.name,
          summary: execution.summary,
          ok: !execution.isError
        })
        for (const reference of execution.references ?? []) {
          references.set(reference.path, reference)
        }
      }
      turns = [
        ...turns,
        { role: 'assistant', content: result.text, toolCalls: result.toolCalls },
        { role: 'tool', results }
      ]
      // 最后一轮若仍在请求工具，用工具结果兜底出结论
      if (round === MAX_TOOL_ROUNDS - 1) {
        finalText =
          result.text ||
          `已完成 ${toolRecords.length} 项操作：${toolRecords.map((r) => r.summary).join('；')}`
      }
    }

    if (!finalText) finalText = '（管家没有回应，请重试）'
    this.persist('assistant', finalText, sessionId)
    return { text: finalText, toolCalls: toolRecords, references: [...references.values()] }
  }

  /** 当前回放给模型的历史消息条数（0 = 不带历史） */
  getContextLimit(): number {
    const raw = this.getMeta(KEY_CONTEXT_LIMIT)
    const parsed = raw === null ? Number.NaN : Number(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_CONTEXT_LIMIT
    return Math.min(MAX_HISTORY, Math.max(0, Math.round(parsed)))
  }

  setContextLimit(limit: number): number {
    const clamped = Math.min(MAX_HISTORY, Math.max(0, Math.round(Number(limit) || 0)))
    this.setMeta(KEY_CONTEXT_LIMIT, String(clamped))
    return clamped
  }

  private historyTurns(sessionId: string): ChatTurn[] {
    const limit = this.getContextLimit()
    if (limit <= 0) return []
    const messages = this.history(sessionId).slice(-limit)
    return messages.map((m): ChatTurn =>
      m.role === 'user'
        ? { role: 'user', content: m.content }
        : { role: 'assistant', content: m.content, toolCalls: [] }
    )
  }

  private toolServices(): ToolServices {
    return {
      calendar: this.services.calendar,
      tasks: this.services.tasks,
      notes: this.services.notes,
      semantic: this.services.semantic ?? null,
      documents: this.services.documents ?? null
    }
  }

  // ---------- 上下文 ----------

  /**
   * 预检索：对用户问题做一次混合检索，把 top 摘录注入 system prompt。
   * 这样即使模型不主动调用工具，也能看到相关内容。
   */
  private async buildPreRetrievalContext(
    question: string,
    sessionId: string
  ): Promise<{ text: string; references: Array<{ path: string; title: string }> }> {
    const empty = { text: '', references: [] as Array<{ path: string; title: string }> }
    const query = question.trim()
    if (query.length < 2) return empty

    // 统一召回：拆词 → 笔记 FTS / 材料 FTS / 路径匹配 / 语义 → RRF
    const startedAt = Date.now()
    const trace = await hybridSearch(query, {
      searchNotes: (term, limit) =>
        this.services.notes.searchNotes(term, limit).map((hit) => ({
          path: hit.path,
          title: hit.title,
          snippet: stripHighlight(hit.snippet)
        })),
      listNoteTitles: () =>
        this.services.notes.listNotes().map((note) => ({ path: note.path, title: note.title })),
      searchDocuments: this.services.documents
        ? (term, limit) => this.services.documents!.search(term, limit)
        : undefined,
      searchDocumentsByPath: this.services.documents
        ? (term, limit) => this.services.documents!.searchByPath(term, limit)
        : undefined,
      searchSemantic: this.services.semantic
        ? async (text, limit) =>
            (await this.services.semantic!.search(text, limit)).map((hit) => ({
              path: hit.path,
              title: hit.title,
              snippet: hit.snippet
            }))
        : undefined
    })
    this.logRetrieval(sessionId, query, trace, Date.now() - startedAt)

    let merged = trace.hits
    let header = '以下是从用户知识库自动检索到的原文摘录（回答时优先引用这些内容）：'

    // 一条都没命中时，至少给出最近编辑的笔记，避免模型只看到日程
    if (merged.length === 0) {
      merged = this.services.notes
        .listNotes()
        .slice(0, 3)
        .map((note) => ({ path: note.path, title: note.title, snippet: '', score: 0 }))
      header = '用户最近编辑的笔记（本次未检索到强相关内容，可参考以下笔记并主动用 search_notes 换关键词再检索）：'
    }
    if (merged.length === 0) return empty

    const lines = merged.map(
      (hit) => `- ${hit.path} | ${hit.title}\n  摘录：${hit.snippet || '（未提供摘录，可用 read_note 读取）'}`
    )
    return {
      text: [header, ...lines].join('\n'),
      references: merged
        .filter((hit) => !/^（根目录）/.test(hit.path))
        .map((hit) => ({ path: hit.path, title: hit.title }))
    }
  }

  /** 检索日志：用于后续调参与反馈闭环 */
  private logRetrieval(sessionId: string, query: string, trace: SearchTrace, latencyMs: number): void {
    try {
      this.db
        .prepare(
          `INSERT INTO retrieval_log (session_id, channel, query, terms, hits, sources, latency_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId,
          sessionId.split(':')[0] ?? 'local',
          query,
          JSON.stringify(trace.terms),
          JSON.stringify(trace.hits.map((hit) => ({ path: hit.path, title: hit.title, score: hit.score }))),
          JSON.stringify(trace.sources),
          Math.round(latencyMs),
          new Date().toISOString()
        )
    } catch (err) {
      console.warn('[retrieval] 日志写入失败:', err instanceof Error ? err.message : err)
    }
  }


  private buildSystemPrompt(): string {
    const now = new Date()
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const calendars = this.services.calendar
      .listCalendars()
      .map((c) => `${c.displayName} (id: ${c.id}, ${c.source === 'caldav' ? 'iCloud 同步' : '本地'})`)
      .join('；')

    // 今日快照：让管家无需工具即可回答"今天有什么安排"
    const todayStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayEvents = this.services.calendar.getEvents({
      start: `${todayStamp}T00:00:00`,
      end: `${todayStamp}T23:59:59.999Z`
    })
    const pendingTasks = this.services.tasks.list('today')

    const eventLines = todayEvents.map((e) =>
      e.allDay
        ? `- 全天：${e.title}`
        : `- ${new Date(e.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} ${e.title}`
    )
    const taskLines = pendingTasks.map((t) => `- [ ] ${t.title}${t.dueAt ? `（截止 ${t.dueAt.slice(0, 10)}）` : ''}`)

    const overview = buildKnowledgeOverview(
      this.services.notes.listNotes(),
      this.services.documents?.status().count ?? 0
    )

    return [
      '你是 secbrain 的私人管家，服务唯一用户。你掌握用户的三类信息：日历（日程）、任务、知识库（个人笔记）。',
      '回答任何与用户个人情况相关的问题时，知识库和日程同等重要，不能只看日程。',
      '',
      `当前时间：${now.toLocaleString('zh-CN', { timeZone })}（时区 ${timeZone}）`,
      `可用日历：${calendars || '（无）'}`,
      '',
      overview,
      '',
      '今天已确定的日程：',
      eventLines.length > 0 ? eventLines.join('\n') : '（无）',
      '',
      '今天的待办任务：',
      taskLines.length > 0 ? taskLines.join('\n') : '（无）',
      '',
      '行为准则：',
      '1. 用中文回复，语气简洁干练，像一个了解主人日程与笔记的管家。',
      '2. 创建/修改/删除日程与任务时，必须调用对应工具，不要只用文字描述。',
      '3. 时间参数优先使用 ISO 8601 带时区偏移（如 2026-10-24T15:00:00+08:00）；用户说自然语言时你直接按当前时间推断。',
      '4. 删除操作前若信息不明确，先向用户确认。',
      '5. 只要问题涉及用户的经历、想法、学习、项目、写作、复盘、计划或个人建议，就必须先看知识库：本轮消息中若已附「检索到的原文摘录」，直接引用；若没有或不够，先调用 search_notes（用你提炼的关键词，可多试两组），再用 read_note 读取原文，必要时用 related_notes 沿链接扩展。',
      '6. 严禁凭空编造笔记内容；检索不到就明确说「知识库中没有找到相关内容」，并说明你检索的关键词。',
      '7. 回答必须落到用户笔记中的具体内容（引用原文要点、笔记标题或路径），不要给放之四海皆准的通用建议。',
      '8. 回答结尾用「参考：路径或标题」列出用到的笔记；没有任何笔记依据时不要杜撰参考。',
      '9. 日程与任务信息用于结合时间上下文（例如建议「今天下午 3 点后有空，可以写 X」），不要把日程当作回答的全部。',
      '10. 涉及多个操作时，依次调用工具，全部完成后给出一句话总结。',
      '11. 如果用户只是闲聊，直接回答，无需调用工具。',
      '12. 历史对话里你曾说过的「查不到/没有相关信息」可能已过时（知识库与材料索引随时更新）。只要本轮消息附了检索资料，就必须以本轮资料为准重新作答，不得沿用旧结论，也不得声明「答案不变」。'
    ].filter((line) => line !== undefined).join('\n')
  }
}
