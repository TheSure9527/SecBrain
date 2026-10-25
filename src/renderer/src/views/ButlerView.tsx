import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiConfigView, ButlerMessage, ToolCallRecord } from '../api'
import { api } from '../api'
import {
  BUTLER_CONTEXT_OPTIONS,
  DEFAULT_BUTLER_CONTEXT_LIMIT
} from '../../../shared/ai'

interface DisplayMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallRecord[]
  references?: Array<{ path: string; title: string }>
  pending?: boolean
}

const QUICK_PROMPTS = [
  '我今天有什么安排？',
  '明天下午3点提醒我给妈妈打电话',
  '帮我把「写周报」安排到本周五上午',
  '关于 Obsidian 我记过什么？',
  '现在有什么待办？'
]

const TOOL_ICONS: Record<string, string> = {
  create_event: '📅',
  update_event: '✏️',
  delete_event: '🗑️',
  query_events: '🔍',
  create_task: '✅',
  complete_task: '☑️',
  list_tasks: '📋',
  convert_task_to_event: '🔁',
  search_notes: '📚',
  read_note: '📄',
  related_notes: '🔗',
  get_daily_brief: '🌅'
}

export function ButlerView(): React.JSX.Element {
  const [config, setConfig] = useState<AiConfigView | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextLimit, setContextLimit] = useState<number>(DEFAULT_BUTLER_CONTEXT_LIMIT)
  const listRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(-1)

  useEffect(() => {
    void api.butler.getContextLimit().then(setContextLimit)
  }, [])

  const pushMessage = useCallback((message: DisplayMessage): void => {
    setMessages((prev) => [...prev, message])
  }, [])

  useEffect(() => {
    void api.butler.getConfig().then(setConfig)
    void api.butler.history().then((history: ButlerMessage[]) => {
      setMessages(
        history.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content
        }))
      )
    })
  }, [])

  // 新消息滚到底部
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setInput('')
    setError(null)
    pushMessage({ id: nextIdRef.current--, role: 'user', content: trimmed })
    pushMessage({ id: nextIdRef.current--, role: 'assistant', content: '', pending: true })
    setSending(true)
    try {
      const reply = await api.butler.chat({ text: trimmed })
      setMessages((prev) => {
        const next = [...prev]
        const pendingIndex = next.findIndex((m) => m.pending)
        if (pendingIndex >= 0) {
          next[pendingIndex] = {
            id: nextIdRef.current--,
            role: 'assistant',
            content: reply.text,
            toolCalls: reply.toolCalls,
            references: reply.references
          }
        }
        return next
      })
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending))
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const handleClear = async (): Promise<void> => {
    await api.butler.clearHistory()
    setMessages([])
  }

  return (
    <div className="butler-view">
      <header className="butler-header">
        <div>
          <h1>私人管家</h1>
          <p className="butler-subtitle">
            对话式管理你的日程、任务与知识库
            {config?.hasKey ? ` · ${config.provider === 'openai' ? 'OpenAI' : 'Claude'} / ${config.model}` : ''}
          </p>
        </div>
        <div className="butler-header-actions">
          <label className="butler-context-select" title="回放给模型的历史对话长度">
            上下文
            <select
              value={contextLimit}
              onChange={(e) =>
                void (async () => {
                  const next = await api.butler.setContextLimit(Number(e.target.value))
                  setContextLimit(next)
                })()
              }
            >
              {BUTLER_CONTEXT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {messages.length > 0 && (
            <button className="btn-ghost" onClick={() => void handleClear()}>
              清空对话
            </button>
          )}
        </div>
      </header>

      {config?.localMode && (
        <div className="butler-local-banner">
          <strong>本地规则模式</strong>
          <span>
            {config.keyError
              ? `${config.keyError}。当前已用离线规则兜底：日程 / 待办 / 记笔记 / 知识库检索。`
              : '未配置大模型，已用离线规则兜底：日程 / 待办 / 记笔记 / 知识库检索。前往「设置 → AI 管家」配置云端 API，或点「检测本地模型」接入 Ollama。'}
          </span>
        </div>
      )}
      <>
          <div className="butler-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="butler-welcome">
                <div className="butler-welcome-icon">🎩</div>
                <p>你好，我是你的私人管家。日程、任务、笔记，都可以直接吩咐我。</p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`butler-msg ${message.role}`}>
                <div className="butler-bubble">
                  {message.pending ? (
                    <span className="butler-typing">思考中…</span>
                  ) : (
                    message.content
                  )}
                </div>
                {message.references && message.references.length > 0 && (
                  <div className="butler-refs">
                    <span className="butler-refs-label">参考</span>
                    {message.references.map((reference) => (
                      <button
                        key={reference.path}
                        className="butler-ref"
                        title={reference.path}
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent('secbrain:open-note', { detail: reference.path })
                          )
                        }
                      >
                        📄 {reference.title}
                      </button>
                    ))}
                  </div>
                )}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="butler-tools">
                    {message.toolCalls.map((call, index) => (
                      <div key={`${call.name}-${index}`} className={`butler-tool ${call.ok ? 'ok' : 'fail'}`}>
                        <span className="butler-tool-icon">{TOOL_ICONS[call.name] ?? '🔧'}</span>
                        <span className="butler-tool-text">{call.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="butler-quick">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                className="butler-chip"
                disabled={sending}
                onClick={() => void send(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          {error && <div className="butler-error">{error}</div>}

          <div className="butler-input-bar">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              placeholder="吩咐我，例如：明天下午3点提醒我给妈妈打电话"
              disabled={sending}
            />
            <button
              className="btn-primary"
              disabled={sending || !input.trim()}
              onClick={() => void send(input)}
            >
              {sending ? '…' : '发送'}
            </button>
          </div>
      </>
    </div>
  )
}
