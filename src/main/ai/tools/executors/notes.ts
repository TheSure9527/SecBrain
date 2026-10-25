import type { ToolServices, ToolExecution } from '../types'
import { rrfMerge, stripHighlight } from '../../search'
import { hybridSearch } from '../../hybrid-search'
import { str } from '../args'
import { normalizeDateTime } from '../../../domain'
import { eventSummaryLine } from '../helpers'

export async function execSearchNotes(
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  const query = str(input.query).trim()
  if (!query) return { output: '缺少搜索词', summary: '搜索笔记失败', isError: true }

  const trace = await hybridSearch(query, {
    searchNotes: (term, limit) =>
      services.notes.searchNotes(term, limit).map((hit) => ({
        path: hit.path,
        title: hit.title,
        snippet: stripHighlight(hit.snippet)
      })),
    listNoteTitles: () =>
      (services.notes.listNotes?.() ?? []).map((note) => ({ path: note.path, title: note.title })),
    searchDocuments: services.documents
      ? (term, limit) => services.documents!.search(term, limit)
      : undefined,
    searchDocumentsByPath: services.documents
      ? (term, limit) => services.documents!.searchByPath(term, limit)
      : undefined,
    searchSemantic: services.semantic
      ? (text, limit) =>
          services.semantic!.search(text, limit).then((hits) =>
            hits.map((hit) => ({ path: hit.path, title: hit.title, snippet: hit.snippet }))
          )
      : undefined
  })

  const merged = trace.hits
  if (merged.length === 0) {
    return { output: '没有找到相关笔记', summary: '没有检索到相关笔记', isError: false }
  }

  const lines = merged.map(
    (hit, index) =>
      `${index + 1}. ${hit.path} | ${hit.title}\n   摘录：${hit.snippet || '（无摘录）'}`
  )
  return {
    output: lines.join('\n'),
    summary: `检索到 ${merged.length} 篇相关笔记`,
    isError: false,
    references: merged.map((hit) => ({ path: hit.path, title: hit.title }))
  }
}

/** 读取笔记全文（超长截断） */
export async function execReadNote(
  input: Record<string, unknown>,
  services: ToolServices
): Promise<ToolExecution> {
  const path = str(input.path).trim()
  if (!path) return { output: '缺少 path', summary: '读取笔记失败', isError: true }
  // 非 Markdown 材料直接走提取正文，避免把二进制当 Markdown 解析
  const isMarkdown = /\.md$/i.test(path)
  const doc = isMarkdown ? await services.notes.readNote(path) : null
  if (!doc) {
    const material = services.documents?.getText(path)
    if (!material) {
      return { output: `文件不存在或无法解析：${path}`, summary: '读取失败', isError: true }
    }
    const LIMIT = 8000
    const content =
      material.text.length > LIMIT
        ? `${material.text.slice(0, LIMIT)}\n\n…（内容过长，已截断，共 ${material.text.length} 字）`
        : material.text
    return {
      output: `路径：${path}\n标题：${material.title}（提取自非 Markdown 文件）\n\n${content}`,
      summary: `读取文档：${material.title}`,
      isError: false,
      references: [{ path, title: material.title }]
    }
  }
  const LIMIT = 8000
  const content =
    doc.content.length > LIMIT
      ? `${doc.content.slice(0, LIMIT)}\n\n…（内容过长，已截断，共 ${doc.content.length} 字）`
      : doc.content
  return {
    output: `路径：${doc.path}\n标题：${doc.title}\n标签：${doc.tags.join(', ') || '无'}\n\n${content}`,
    summary: `读取笔记：${doc.title}`,
    isError: false,
    references: [{ path: doc.path, title: doc.title }]
  }
}

/** 基于链接图谱找相关笔记（反链 + 出链） */
export function execRelatedNotes(
  input: Record<string, unknown>,
  services: ToolServices
): ToolExecution {
  const path = str(input.path).trim()
  if (!path) return { output: '缺少 path', summary: '查询相关笔记失败', isError: true }

  const graph = services.notes.graph()
  const titleOf = new Map(graph.nodes.map((node) => [node.id, node.title]))
  const related = new Set<string>()
  for (const backlink of services.notes.backlinks(path)) {
    if (!backlink.path.endsWith('.md')) continue
    related.add(backlink.path)
  }
  for (const edge of graph.edges) {
    if (edge.source !== path) continue
    if (!edge.target.endsWith('.md')) continue
    related.add(edge.target)
  }
  related.delete(path)

  const list = [...related].slice(0, 12)
  if (list.length === 0) {
    return { output: '这篇笔记没有关联的笔记', summary: '没有关联笔记', isError: false }
  }
  const lines = list.map((p) => `- ${p} | ${titleOf.get(p) ?? p}`)
  return {
    output: lines.join('\n'),
    summary: `找到 ${list.length} 篇关联笔记`,
    isError: false,
    references: list.map((p) => ({ path: p, title: titleOf.get(p) ?? p }))
  }
}

export function execDailyBrief(
  input: Record<string, unknown>,
  services: ToolServices
): ToolExecution {
  const ref = new Date()
  const dateStamp =
    (input.date ? normalizeDateTime(input.date, ref) : null)?.slice(0, 10) ??
    `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`
  const events = services.calendar.getEvents({
    start: `${dateStamp}T00:00:00`,
    end: `${dateStamp}T23:59:59.999Z`
  })
  const tasks = services.tasks.list('today')
  const eventLines = events.map((e) => eventSummaryLine(e))
  const taskLines = tasks.map((t) => `[ ] ${t.title}${t.dueAt ? ` (截止 ${t.dueAt.slice(0, 10)})` : ''}`)
  const parts = [`${dateStamp} 的安排：`]
  parts.push(eventLines.length > 0 ? eventLines.join('\n') : '（无日程）')
  parts.push('待办任务：')
  parts.push(taskLines.length > 0 ? taskLines.join('\n') : '（无待办）')
  return {
    output: parts.join('\n'),
    summary: `已生成 ${dateStamp} 的摘要`,
    isError: false
  }
}
