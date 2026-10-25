/**
 * 检索评测脚本（不调 LLM）
 *
 * 用真实知识库把 40 条评测集跑一遍混合检索，输出 Recall@5 / MRR / 拒答正确率，
 * 并对失败题做归因（未召回 / 排序靠后）。
 *
 * 用法：
 *   npx vite-node scripts/eval-retrieval.ts
 *   npx vite-node scripts/eval-retrieval.ts --limit 10
 *   MYZSK_DB=/path/to/myzsk.db npx vite-node scripts/eval-retrieval.ts
 */
import { readFileSync } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hybridSearch } from '../src/main/ai/hybrid-search'
import {
  BuiltinEmbeddingProvider,
  bufferToVector,
  cosineSimilarity
} from '../src/main/semantic/embedding'
import { DocumentIndexer } from '../src/main/indexer/document-index'
import { NoteIndex } from '../src/main/vault/note-index'
import { Vault } from '../src/main/vault/vault'

interface EvalItem {
  id: string
  type: 'fact' | 'aggregate' | 'no-answer'
  question: string
  mustHit: string[]
  mustContain?: string[]
  expectNoAnswer?: boolean
}

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const TOP_K = 5
const args = process.argv.slice(2)
const limitArg = args.indexOf('--limit')
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Number.POSITIVE_INFINITY

const localPath = 'tests/eval/questions.local.json'
const examplePath = 'tests/eval/questions.example.json'
const datasetPath = existsSync(localPath) ? localPath : examplePath
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as {
  items: EvalItem[]
  vault?: string
}
const dbPath =
  process.env['MYZSK_DB'] ?? join(homedir(), 'Library/Application Support/myzsk/myzsk.db')

const db = new DatabaseSync(dbPath, { readOnly: true })
const noteIndex = new NoteIndex(db)
const documents = new DocumentIndexer(db, new Vault(dataset.vault ?? join(homedir(), 'myzsk-vault')))

const useSemantic = args.includes('--semantic')
const minScoreArg = args.indexOf('--min-score')
/** 语义相似度阈值：低于它的候选不进入融合（无阈值会让拒答题全部误召回） */
const MIN_SEMANTIC_SCORE = minScoreArg >= 0 ? Number(args[minScoreArg + 1]) : 0.45
let semanticSearch:
  | ((text: string, limit: number) => Promise<Array<{ path: string; title: string; snippet: string }>>)
  | undefined

if (useSemantic) {
  const settingsRow = db.prepare("SELECT value FROM meta WHERE key='app.settings'").get() as
    | { value: string }
    | undefined
  const settings = settingsRow ? JSON.parse(settingsRow.value) : {}
  const model = settings.semanticModel ?? 'Xenova/bge-small-zh-v1.5'
  const provider = new BuiltinEmbeddingProvider(
    model,
    join(homedir(), 'Library/Application Support/myzsk/models')
  )
  const chunks = db
    .prepare('SELECT path, text, vector FROM note_chunks')
    .all() as Array<{ path: string; text: string; vector: Uint8Array }>
  const byPath = new Map<string, Array<{ text: string; vector: Float32Array }>>()
  for (const chunk of chunks) {
    const list = byPath.get(chunk.path) ?? []
    list.push({ text: chunk.text, vector: bufferToVector(chunk.vector) })
    byPath.set(chunk.path, list)
  }
  const titles = new Map<string, string>([
    ...noteIndex.list().map((note) => [note.path, note.title] as [string, string]),
    ...documents.titles().map((doc) => [doc.path, doc.title] as [string, string])
  ])
  semanticSearch = async (text, limit) => {
    const [query] = await provider.embed([text])
    if (!query) return []
    const best = new Map<string, { score: number; text: string }>()
    for (const [path, list] of byPath) {
      for (const chunk of list) {
        const score = cosineSimilarity(query, chunk.vector)
        const current = best.get(path)
        if (!current || score > current.score) best.set(path, { score, text: chunk.text })
      }
    }
    return [...best.entries()]
      .map(([path, info]) => ({
        path,
        title: titles.get(path) ?? path.split('/').pop() ?? path,
        snippet: info.text.slice(0, 120),
        score: info.score
      }))
      .filter((entry) => entry.score >= MIN_SEMANTIC_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}

const sources = {
  searchNotes: (term: string, take = 6) =>
    noteIndex.search(term, take).map((hit) => ({
      path: hit.path,
      title: hit.title,
      snippet: hit.snippet.replace(/<\/?mark>/g, '')
    })),
  listNoteTitles: () => noteIndex.list().map((note) => ({ path: note.path, title: note.title })),
  searchDocuments: (term: string, take = 6) => documents.search(term, take),
  searchDocumentsByPath: (term: string, take = 5) => documents.searchByPath(term, take),
  searchSemantic: semanticSearch
}

interface Result {
  id: string
  type: EvalItem['type']
  question: string
  rank: number | null
  hitCount: number
  reason?: string
}

function rankOf(paths: string[], mustHit: string[]): number | null {
  const wanted = new Set(mustHit)
  for (let i = 0; i < paths.length; i += 1) {
    if (wanted.has(paths[i]!)) return i + 1
  }
  return null
}

const results: Result[] = []

for (const item of dataset.items.slice(0, limit)) {
  const trace = await hybridSearch(item.question, sources, 8)
  const paths = trace.hits.map((hit) => hit.path)

  if (item.type === 'no-answer') {
    results.push({
      id: item.id,
      type: item.type,
      question: item.question,
      rank: null,
      hitCount: paths.length,
      reason: paths.length === 0 ? undefined : `误召回 ${paths[0]}`
    })
    continue
  }

  const rank = rankOf(paths, item.mustHit)
  const reason =
    rank === null
      ? '未召回（top8 无目标）'
      : rank > TOP_K
        ? `排序靠后（第 ${rank} 名）`
        : undefined
  results.push({
    id: item.id,
    type: item.type,
    question: item.question,
    rank,
    hitCount: paths.length,
    reason
  })
}

const answerable = results.filter((r) => r.type !== 'no-answer')
const nanswers = results.filter((r) => r.type === 'no-answer')
const recallAt = (list: Result[], k: number): number =>
  list.filter((r) => r.rank !== null && r.rank <= k).length
const mrr = (list: Result[]): number =>
  list.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / Math.max(1, list.length)

const pct = (a: number, b: number): string => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`
const fact = answerable.filter((r) => r.type === 'fact')
const agg = answerable.filter((r) => r.type === 'aggregate')

console.log(`\n检索评测  ${datasetPath}  (top${TOP_K}${useSemantic ? ` · 含语义 ≥${MIN_SEMANTIC_SCORE}` : ' · 仅关键词'})`)
console.log(`库：${dbPath}`)
console.log(`题数：${results.length}（事实 ${fact.length} / 汇总 ${agg.length} / 拒答 ${nanswers.length}）\n`)

const rows: Array<[string, number, number, number]> = [
  ['事实型', recallAt(fact, TOP_K), fact.length, mrr(fact)],
  ['汇总型', recallAt(agg, TOP_K), agg.length, mrr(agg)],
  ['合计', recallAt(answerable, TOP_K), answerable.length, mrr(answerable)]
]
for (const [label, hit, total, score] of rows) {
  console.log(
    `${label.padEnd(4, ' ')}  Recall@${TOP_K} ${String(hit).padStart(2)}/${total} (${pct(hit, total)})   MRR ${score.toFixed(3)}`
  )
}
const noAnswerOk = nanswers.filter((r) => r.hitCount === 0).length
console.log(`拒答型  正确 ${noAnswerOk}/${nanswers.length} (${pct(noAnswerOk, nanswers.length)})`)

const failures = results.filter((r) => r.reason)
if (failures.length > 0) {
  console.log(`\n失败明细（${failures.length}）：`)
  for (const f of failures) {
    console.log(`  - ${f.id}  ${f.reason}  「${f.question}」`)
  }
} else {
  console.log('\n全部命中')
}

const noAnswerFailures = nanswers.filter((r) => r.hitCount > 0)
if (noAnswerFailures.length > 0) {
  console.log(`\n拒答题误召回（${noAnswerFailures.length}）：`)
  for (const f of noAnswerFailures) console.log(`  - ${f.id}  ${f.reason}`)
}

console.log('')
process.exit(0)
