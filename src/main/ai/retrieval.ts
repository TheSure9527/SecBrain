/** 提问 → 检索词的轻量处理（无分词依赖，纯函数） */

/** 常见疑问/指令短语：从提问中剔除，留下实质内容 */
const STOP_PHRASES = [
  '结合我的笔记',
  '根据我的笔记',
  '结合知识库',
  '根据知识库',
  '从我的笔记',
  '帮我看看',
  '帮我想想',
  '帮我整理',
  '帮我分析',
  '帮我',
  '帮忙',
  '可不可以',
  '能不能',
  '是否可以',
  '有没有',
  '怎么样',
  '为什么',
  '是什么',
  '有哪些',
  '怎么办',
  '怎么',
  '如何',
  '哪些',
  '什么',
  '一些',
  '一下',
  '关于',
  '以及',
  '还有',
  '我的',
  '我们',
  '这个',
  '那个',
  '建议',
  '意见',
  '想法',
  '总结',
  '整理',
  '分析',
  '看看',
  '请'
]

const PUNCT_RE = /[，。！？、；：""''（）【】《》,.!?;:"'()[\]{}<>~`·…\s]+/g

/** 单个功能字：中文里不承载检索价值 */
const SINGLE_STOP_CHARS = /[我你他她它们的了是在有和与就都也很吗呢吧啊呀个些这那其为之所被把给对向从到而或但若是说请帮想要会能可]/g

const ASCII_RE = /^[a-zA-Z0-9_\-.#+]+$/

/**
 * 从提问中提取检索词（无分词库，采用「去停用词 + 2/3 字滑窗」策略）：
 * - 英文/数字片段按空格整词使用
 * - 中文片段生成 2 字与 3 字滑窗（FTS trigram 可匹配 3 字，短词走 LIKE）
 * 例：「我是什么专业的学生」→ 专业 / 业学 / 学生 / 专业的 / 业的学 / 的学生
 */
export function extractSearchTerms(question: string, limit = 6): string[] {
  const sorted = [...STOP_PHRASES].sort((a, b) => b.length - a.length)
  let text = question.replace(PUNCT_RE, ' ')
  for (const phrase of sorted) {
    text = text.split(phrase).join(' ')
  }
  text = text.replace(SINGLE_STOP_CHARS, ' ')

  const segments = text
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2)

  const terms: string[] = []
  for (const segment of segments) {
    if (ASCII_RE.test(segment)) {
      terms.push(segment)
      continue
    }
    if (segment.length <= 4) terms.push(segment)
    // 2 字滑窗
    for (let i = 0; i + 2 <= segment.length; i += 1) {
      terms.push(segment.slice(i, i + 2))
    }
    // 3 字滑窗（FTS trigram 精确匹配更可靠）
    for (let i = 0; i + 3 <= segment.length; i += 1) {
      terms.push(segment.slice(i, i + 3))
    }
  }
  return [...new Set(terms)].slice(0, limit)
}

export interface OverviewNote {
  path: string
  title: string
  tags: string[]
  updatedAt: string
}

/** 知识库概况文本：让模型知道库里有什么、最近写过什么 */
export function buildKnowledgeOverview(notes: OverviewNote[], materialCount = 0): string {
  const materialLine =
    materialCount > 0
      ? `- 另有 ${materialCount} 份材料（docx/pdf/xlsx/文本等，含简历、合同、报表），可用 search_notes 检索、read_note 阅读`
      : ''

  if (notes.length === 0) {
    return ['知识库概况：当前知识库还没有 Markdown 笔记。', materialLine].filter(Boolean).join('\n')
  }

  const dirCount = new Map<string, number>()
  const tagCount = new Map<string, number>()
  for (const note of notes) {
    const dir = note.path.includes('/') ? note.path.split('/')[0]! : '（根目录）'
    dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1)
    for (const tag of note.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  }

  const dirs = [...dirCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([dir, count]) => `${dir}(${count})`)
  const tags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => `#${tag}(${count})`)

  const recent = [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((note) => `${note.path} | ${note.title}`)

  return [
    `知识库概况：共 ${notes.length} 篇 Markdown 笔记。`,
    dirs.length > 0 ? `- 主要目录：${dirs.join('、')}` : '',
    tags.length > 0 ? `- 常用标签：${tags.join('、')}` : '',
    materialLine,
    recent.length > 0 ? `- 最近更新：\n${recent.map((line) => `  · ${line}`).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}
