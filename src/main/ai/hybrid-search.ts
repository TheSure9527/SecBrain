import { extractSearchTerms } from './retrieval'
import { rrfMerge, type MergedHit } from './search'

/** 检索数据源（由应用层/评测脚本各自实现，便于复用同一套融合逻辑） */
export interface SearchSources {
  searchNotes(query: string, limit?: number): Array<{ path: string; title: string; snippet: string }>
  listNoteTitles(): Array<{ path: string; title: string }>
  searchDocuments?: (
    query: string,
    limit?: number
  ) => Array<{ path: string; title: string; snippet: string }>
  searchDocumentsByPath?: (
    term: string,
    limit?: number
  ) => Array<{ path: string; title: string; snippet: string }>
  searchSemantic?: (
    query: string,
    limit?: number
  ) => Promise<Array<{ path: string; title: string; snippet: string }>>
}

/** 单次检索的候选（供日志与评测分析） */
export interface SearchTrace {
  terms: string[]
  hits: MergedHit[]
  /** 各路召回的原始条数，便于定位"没召回"还是"没排上" */
  sources: Array<{ name: string; count: number }>
}

/**
 * 混合检索：中文拆词 → 笔记 FTS / 材料 FTS / 路径匹配 / 语义向量 → RRF 融合。
 * 线上工具与离线评测共用，避免两套逻辑漂移。
 */
export async function hybridSearch(
  query: string,
  sources: SearchSources,
  limit = 8
): Promise<SearchTrace> {
  const terms = extractSearchTerms(query)
  const searchTerms = terms.length > 0 ? terms.slice(0, 4) : [query]

  const lists: Array<Array<{ path: string; title: string; snippet: string }>> = []
  const pathHits: Array<{ path: string; title: string; snippet: string }> = []
  const trace: SearchTrace['sources'] = []

  for (const term of searchTerms) {
    const noteHits = sources.searchNotes(term, 6)
    trace.push({ name: `notes:${term}`, count: noteHits.length })
    lists.push(noteHits)

    if (sources.searchDocuments) {
      const docHits = sources.searchDocuments(term, 6)
      trace.push({ name: `docs:${term}`, count: docHits.length })
      lists.push(docHits)
    }

    if (sources.searchDocumentsByPath) {
      const pathDocHits = sources.searchDocumentsByPath(term, 5)
      trace.push({ name: `path:${term}`, count: pathDocHits.length })
      pathHits.push(...pathDocHits)
    }

    for (const note of sources.listNoteTitles()) {
      if (note.path.toLowerCase().includes(term.toLowerCase())) {
        pathHits.push({ path: note.path, title: note.title, snippet: `位于：${note.path}` })
      }
    }
  }

  if (pathHits.length > 0) lists.push(pathHits)

  if (sources.searchSemantic) {
    try {
      const semanticHits = await sources.searchSemantic(query, 10)
      trace.push({ name: 'semantic', count: semanticHits.length })
      lists.push(semanticHits)
    } catch {
      trace.push({ name: 'semantic', count: 0 })
    }
  }

  return { terms: searchTerms, hits: rrfMerge(lists, limit), sources: trace }
}
