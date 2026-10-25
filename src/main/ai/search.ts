/** 混合检索融合（纯函数）：RRF（Reciprocal Rank Fusion） */

export interface RankedHit {
  path: string
  title: string
  snippet: string
}

export interface MergedHit extends RankedHit {
  score: number
}

/** 把多路检索结果按 RRF 融合：score = Σ 1/(60 + rank) */
export function rrfMerge(lists: RankedHit[][], limit = 8, k = 60): MergedHit[] {
  const scores = new Map<string, MergedHit>()
  lists.forEach((list) => {
    list.forEach((hit, rank) => {
      const add = 1 / (k + rank + 1)
      const existing = scores.get(hit.path)
      if (existing) {
        existing.score += add
        if (!existing.snippet && hit.snippet) existing.snippet = hit.snippet
      } else {
        scores.set(hit.path, { ...hit, score: add })
      }
    })
  })
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

/** 去掉 FTS 结果里的 <mark> 高亮标签 */
export function stripHighlight(html: string): string {
  return html.replace(/<\/?mark>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
