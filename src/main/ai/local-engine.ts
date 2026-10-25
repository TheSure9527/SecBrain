import type { ButlerReply } from '../../shared/ai'
import { normalizeDateTime } from '../domain'
import type { ToolServices } from './tools/types'
import { execCreateEvent, execQueryEvents } from './tools/executors/calendar'
import { execCreateTask, execListTasks } from './tools/executors/tasks'
import { execSearchNotes } from './tools/executors/notes'

/** 本地规则引擎能识别的意图 */
export type LocalIntent =
  | 'agenda'
  | 'tasks'
  | 'create_event'
  | 'create_task'
  | 'create_note'
  | 'search'
  | 'help'

const AGENDA_RE = /(今天|明天|后天|本周|这周|下周)[^。！？]*(安排|日程|会议|事项)|有什么安排|我的日程|今天要做什么/
const TASKS_RE = /(待办|任务)[^。！？]*(哪些|有什么|列出|看看)|(待办|任务)列表|我还有(什么|哪些)/
const CREATE_EVENT_RE =
  /(提醒我|安排|加个|加一个|创建|新建)[^。！？]*(日程|会议|事件|约会)|^(提醒我|安排)/
const CREATE_TASK_RE = /(提醒我|记下|待办)[^。！？]*(做|完成|交|准备|写)|^(提醒我|记下)/
const CREATE_NOTE_RE = /^(记一条|记一下|新建笔记|写下|记录)/
const HELP_RE = /^(帮助|你能做什么|怎么用|help)$/i
/** 判断"这件事该占时间（日程）还是只是待办" */
const EVENT_WORDS = /(开会|会议|日程|事件|约会|面试|答辩|聚餐|上课|见|约)/

/**
 * 无 API Key 时的兜底：用纯规则把高频指令映射到应用层用例。
 * 不做自然语言理解，只保证"日程 / 待办 / 记笔记 / 搜索"四类操作可用。
 */
export class LocalEngine {
  constructor(private readonly services: ToolServices) {}

  /** 规则命中判断（供 UI 提示"这条能否离线处理"） */
  classify(text: string): LocalIntent {
    const input = text.trim()
    if (HELP_RE.test(input)) return 'help'
    if (AGENDA_RE.test(input)) return 'agenda'
    if (TASKS_RE.test(input)) return 'tasks'
    if (CREATE_NOTE_RE.test(input)) return 'create_note'
    if (CREATE_EVENT_RE.test(input) || CREATE_TASK_RE.test(input)) {
      // 含"会/日程/面试"这类词按日程处理，其余按待办
      return EVENT_WORDS.test(input) ? 'create_event' : 'create_task'
    }
    return 'search'
  }

  async reply(text: string): Promise<ButlerReply> {
    const intent = this.classify(text)
    const record = (summary: string): ButlerReply['toolCalls'] => [
      { name: `local.${intent}`, summary, ok: true }
    ]

    try {
      if (intent === 'help') return this.helpText(record)
      if (intent === 'agenda') return await this.agenda(text)
      if (intent === 'tasks') return await this.tasks()
      if (intent === 'create_note') return await this.createNote(text)
      if (intent === 'create_event') return await this.createEvent(text)
      if (intent === 'create_task') return await this.createTask(text)
      return await this.search(text)
    } catch (err) {
      return {
        text: `本地规则模式处理失败：${err instanceof Error ? err.message : String(err)}`,
        toolCalls: [{ name: `local.${intent}`, summary: '失败', ok: false }],
        references: []
      }
    }
  }

  private helpText(record: (s: string) => ButlerReply['toolCalls']): ButlerReply {
    return {
      text: [
        '当前是**本地规则模式**（未配置大模型，完全离线）：',
        '',
        '- 「我今天有什么安排」→ 汇总日程与待办',
        '- 「提醒我明天下午三点开会」→ 创建日历事件',
        '- 「提醒我周五交材料」→ 创建任务',
        '- 「记一条：xxx」→ 新建笔记',
        '- 其他问题 → 直接搜知识库并给出原文摘录',
        '',
        '配置 API Key 或本地模型后，可以用自然语言做更复杂的安排。'
      ].join('\n'),
      toolCalls: [{ name: 'local.help', summary: '帮助', ok: true }],
      references: []
    }
  }

  private async agenda(text: string): Promise<ButlerReply> {
    const day = /明天/.test(text) ? 1 : /后天/.test(text) ? 2 : 0
    const start = new Date()
    start.setDate(start.getDate() + day)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    const events = await execQueryEvents(
      { start_at: start.toISOString(), end_at: end.toISOString() },
      this.services
    )
    const tasks = await execListTasks({ filter: 'today' }, this.services)
    const label = day === 0 ? '今天' : day === 1 ? '明天' : '后天'

    const lines: string[] = [`**${label}的安排**`, '']
    const eventLines = events.output.split('\n').filter((line) => line.trim())
    lines.push(eventLines.length > 0 ? events.output : '· 无日程')
    lines.push('', '**待办**')
    lines.push(tasks.isError ? '· 读取失败' : tasks.output || '· 无待办')
    if (!tasks.isError && /没有/.test(tasks.output)) lines.push('· 无待办')

    return {
      text: lines.join('\n'),
      toolCalls: [
        { name: 'local.agenda', summary: events.summary, ok: true }
      ],
      references: []
    }
  }

  private async tasks(): Promise<ButlerReply> {
    const result = await execListTasks({ filter: 'all' }, this.services)
    return {
      text: result.output,
      toolCalls: [{ name: 'local.tasks', summary: result.summary, ok: true }],
      references: []
    }
  }

  private async createEvent(text: string): Promise<ButlerReply> {
    const startAt = normalizeDateTime(text)
    if (!startAt) {
      return {
        text: '没能从这句话里识别出时间。试试「明天下午三点开会」这种写法。',
        toolCalls: [{ name: 'local.create_event', summary: '缺少时间', ok: false }],
        references: []
      }
    }
    const allDay = startAt.length === 10
    const start = new Date(startAt)
    const end = new Date(allDay ? start.getTime() + 86_400_000 : start.getTime() + 3_600_000)
    const result = await execCreateEvent(
      {
        title: stripIntentWords(text),
        start_at: startAt,
        end_at: allDay ? end.toISOString().slice(0, 10) : end.toISOString(),
        all_day: allDay
      },
      this.services
    )
    return {
      text: result.output,
      toolCalls: [
        { name: 'local.create_event', summary: result.summary, ok: !result.isError }
      ],
      references: []
    }
  }

  private async createTask(text: string): Promise<ButlerReply> {
    const dueAt = normalizeDateTime(text)
    const result = await execCreateTask(
      { title: stripIntentWords(text), due_at: dueAt ?? null },
      this.services
    )
    let readable = result.output
    try {
      const parsed = JSON.parse(result.output) as { title?: string; due_at?: string | null }
      if (parsed.title) {
        readable = parsed.due_at
          ? `已创建任务「${parsed.title}」，截止 ${new Date(parsed.due_at).toLocaleString('zh-CN')}`
          : `已创建任务「${parsed.title}」（无截止时间）`
      }
    } catch {
      // 保持原文
    }
    return {
      text: readable,
      toolCalls: [
        { name: 'local.create_task', summary: result.summary, ok: !result.isError }
      ],
      references: []
    }
  }

  private async createNote(text: string): Promise<ButlerReply> {
    const body = text.replace(CREATE_NOTE_RE, '').replace(/^[:：\s]+/, '').trim()
    const title = body.split(/[。\n]/)[0]?.slice(0, 40) || '速记'
    const note = await this.services.notes.createNote({ title, content: body })
    return {
      text: `已创建笔记「${note.title}」（${note.path}）`,
      toolCalls: [
        { name: 'local.create_note', summary: note.path, ok: true }
      ],
      references: [{ path: note.path, title: note.title }]
    }
  }

  private async search(text: string): Promise<ButlerReply> {
    const result = await execSearchNotes({ query: text }, this.services)
    const header = result.isError
      ? ''
      : '当前为**本地规则模式**（关键词检索，未接入大模型）。找到以下内容：\n'
    return {
      text: `${header}${result.output}`,
      toolCalls: [
        { name: 'local.search', summary: result.summary, ok: !result.isError }
      ],
      references: result.references ?? []
    }
  }
}

/** 去掉「提醒我 / 帮我」等指令词，留下事件/任务标题 */
function stripIntentWords(text: string): string {
  const cleaned = text
    .replace(/^(帮我|请|麻烦)?\s*(提醒我|记一下|记下|安排|创建|新建|加个|加一个)\s*/g, '')
    .replace(/[，,。]\s*$/, '')
    .trim()
  const title = cleaned.replace(
    /(今天|明天|后天|本周|这周|下周|上午|下午|晚上|中午|\d{1,2}[点:：]\d{0,2}|周[一二三四五六日天])/g,
    ''
  )
  return (title || cleaned || '未命名事项').replace(/\s{2,}/g, ' ').trim()
}
