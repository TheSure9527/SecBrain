/**
 * 切片长度对比实验（语义检索）
 *
 * 做法：
 *   1. 把语料切成 ~250 字的「基础单元」并编码一次（缓存到 /tmp/secbrain-units.json）
 *   2. 用相邻单元合并出 250/500/750/1000 四种切片粒度（向量取均值后归一化）
 *   3. 对 40 条评测集算 Recall@5 / MRR，比较哪种粒度最合适
 *
 * 用法：
 *   npx vite-node scripts/eval-chunk.ts
 *   npx vite-node scripts/eval-chunk.ts --model Xenova/bge-base-zh-v1.5
 *   npx vite-node scripts/eval-chunk.ts --true 600    # 用真实切分复核某一档
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BuiltinEmbeddingProvider } from '../src/main/semantic/embedding'
import { chunkMarkdown } from '../src/main/semantic/chunker'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const args = process.argv.slice(2)
const modelArg = args.indexOf('--model')
const MODEL = modelArg >= 0 ? args[modelArg + 1]! : 'Xenova/bge-small-zh-v1.5'
const trueArg = args.indexOf('--true')
const TRUE_SIZE = trueArg >= 0 ? Number(args[trueArg + 1]) : 0

const BASE_UNIT = 250
const CACHE = '/tmp/secbrain-units.json'
const SIZES = [250, 500, 750, 1000]
const DOC_CHAR_CAP = 30_000
const DOC_EXTS = "('docx','pdf','xlsx','pptx','txt','csv','html')"

interface Unit {
  doc: string
  text: string
  vector?: number[]
}

const dataset = JSON.parse(readFileSync('tests/eval/questions.json', 'utf8')) as {
  items: Array<{ id: string; type: string; question: string; mustHit: string[] }>
}

const db = new DatabaseSync(
  join(homedir(), 'Library/Application Support/secbrain/secbrain.db'),
  { readOnly: true }
)

/** 句子切分后打包成 ~250 字的基础单元 */
function toUnits(doc: string, text: string): Unit[] {
  const cleaned = text.replace(/^---[\s\S]*?---\n/, '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const sentences = cleaned.split(/(?<=[。！？!?；;\n])/).filter((s) => s.trim())
  const units: Unit[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (buffer.length + sentence.length > BASE_UNIT && buffer) {
      units.push({ doc, text: buffer })
      buffer = ''
    }
    buffer += sentence
    while (buffer.length > BASE_UNIT * 2) {
      units.push({ doc, text: buffer.slice(0, BASE_UNIT) })
      buffer = buffer.slice(BASE_UNIT)
    }
  }
  if (buffer.trim()) units.push({ doc, text: buffer })
  return units
}

function loadCorpus(): Unit[] {
  const docs = db
    .prepare(`SELECT path, text FROM documents WHERE ext IN ${DOC_EXTS}`)
    .all() as Array<{ path: string; text: string }>
  const notes = db.prepare('SELECT path, content FROM notes_fts').all() as Array<{
    path: string
    content: string
  }>

  const units: Unit[] = []
  for (const doc of docs) units.push(...toUnits(doc.path, (doc.text ?? '').slice(0, DOC_CHAR_CAP)))
  for (const note of notes) units.push(...toUnits(note.path, note.content ?? ''))
  return units
}

function corpusHash(units: Unit[]): string {
  const hash = createHash('sha1')
  hash.update(String(units.length))
  for (const unit of units) hash.update(unit.doc).update(unit.text)
  return hash.digest('hex').slice(0, 12)
}

function normalize(vector: number[]): number[] {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum) || 1
  return vector.map((value) => value / norm)
}

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0]!.length
  const out = new Array<number>(dim).fill(0)
  for (const vector of vectors) for (let i = 0; i < dim; i += 1) out[i]! += vector[i]!
  return normalize(out.map((value) => value / vectors.length))
}

function cosine(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!
  return sum
}

async function embedAll(
  provider: BuiltinEmbeddingProvider,
  texts: string[],
  label: string
): Promise<number[][]> {
  const out: number[][] = []
  const batchSize = 16
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize)
    const vectors = await provider.embed(batch)
    for (const vector of vectors) out.push(Array.from(vector))
    if (offset % 800 === 0) {
      console.log(`  ${label} ${Math.min(offset + batchSize, texts.length)}/${texts.length}`)
    }
  }
  return out
}

async function main(): Promise<void> {
  const provider = new BuiltinEmbeddingProvider(
    MODEL,
    join(homedir(), 'Library/Application Support/secbrain/models')
  )

  const questions = dataset.items.filter((item) => item.type !== 'no-answer')
  const noAnswers = dataset.items.filter((item) => item.type === 'no-answer')
  const queryVectors = await embedAll(
    provider,
    [...questions, ...noAnswers].map((item) => item.question),
    '问题'
  )
  const questionVector = new Map<string, number[]>()
  for (const [index, item] of [...questions, ...noAnswers].entries()) {
    questionVector.set(item.id, queryVectors[index]!)
  }

  if (TRUE_SIZE) {
    // 真实切分复核：chunkMarkdown + 全量编码
    const units = loadCorpus()
    const docs = new Map<string, string>()
    for (const unit of units) docs.set(unit.doc, (docs.get(unit.doc) ?? '') + unit.text)
    const chunks: Array<{ doc: string; vector: number[] }> = []
    for (const [doc, text] of docs) {
      const parts = chunkMarkdown(text, TRUE_SIZE)
      const vectors = await embedAll(
        provider,
        parts.map((part) => part.text),
        `切片 ${TRUE_SIZE}`
      )
      parts.forEach((_, index) => chunks.push({ doc, vector: vectors[index]! }))
    }
    report(chunks, questions, noAnswers, questionVector, `真实切分 ${TRUE_SIZE}`)
    return
  }

  const units = loadCorpus()
  const hash = corpusHash(units)
  let vectors: number[][] | null = null
  if (existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, 'utf8')) as {
      hash: string
      model: string
      vectors: number[][]
    }
    if (cached.hash === hash && cached.model === MODEL && cached.vectors.length === units.length) {
      vectors = cached.vectors
      console.log(`复用缓存的基础单元向量（${units.length} 个）`)
    }
  }
  if (!vectors) {
    console.log(`编码 ${units.length} 个基础单元（~${BASE_UNIT} 字）…`)
    vectors = await embedAll(
      provider,
      units.map((unit) => unit.text),
      '单元'
    )
    writeFileSync(CACHE, JSON.stringify({ hash, model: MODEL, vectors }))
  }

  for (const size of SIZES) {
    const chunks: Array<{ doc: string; vector: number[] }> = []
    let i = 0
    while (i < units.length) {
      const doc = units[i]!.doc
      const group: number[][] = []
      let length = 0
      while (i < units.length && units[i]!.doc === doc && length < size) {
        group.push(vectors[i]!)
        length += units[i]!.text.length
        i += 1
      }
      chunks.push({ doc, vector: group.length === 1 ? group[0]! : meanVector(group) })
    }
    report(chunks, questions, noAnswers, questionVector, `合并切片 ${size}`)
  }
}

function report(
  chunks: Array<{ doc: string; vector: number[] }>,
  questions: Array<{ id: string; question: string; mustHit: string[] }>,
  noAnswers: Array<{ id: string; question: string }>,
  questionVector: Map<string, number[]>,
  label: string
): void {
  const score = (vector: number[]): Array<{ doc: string; score: number }> => {
    const best = new Map<string, number>()
    for (const chunk of chunks) {
      const value = cosine(vector, chunk.vector)
      if (!best.has(chunk.doc) || value > best.get(chunk.doc)!) best.set(chunk.doc, value)
    }
    return [...best.entries()]
      .map(([doc, value]) => ({ doc, score: value }))
      .sort((a, b) => b.score - a.score)
  }

  let hit5 = 0
  let mrrSum = 0
  const failures: string[] = []
  for (const item of questions) {
    const ranked = score(questionVector.get(item.id)!)
    const wanted = new Set(item.mustHit)
    let rank = 0
    for (let i = 0; i < ranked.length; i += 1) {
      if (wanted.has(ranked[i]!.doc)) {
        rank = i + 1
        break
      }
    }
    if (rank > 0 && rank <= 5) hit5 += 1
    if (rank > 0) mrrSum += 1 / rank
    if (rank === 0 || rank > 5) failures.push(`${item.id}(第${rank || '未'}名)`)
  }

  let noAnswerHits = 0
  let noAnswerTopSum = 0
  for (const item of noAnswers) {
    const ranked = score(questionVector.get(item.id)!)
    noAnswerTopSum += ranked[0]?.score ?? 0
    if ((ranked[0]?.score ?? 0) > 0.5) noAnswerHits += 1
  }

  const recall = (hit5 / questions.length) * 100
  const mrr = mrrSum / questions.length
  console.log(
    `${label.padEnd(14)} 切片 ${String(chunks.length).padStart(6)} 个 · Recall@5 ${recall.toFixed(1)}% · MRR ${mrr.toFixed(3)} · 拒答误召回(>0.5) ${noAnswerHits}/${noAnswers.length} · 平均top1 ${(noAnswerTopSum / noAnswers.length).toFixed(3)}`
  )
  if (failures.length > 0 && label.includes('750')) {
    console.log(`  未命中：${failures.join(' ')}`)
  }
}

main().catch((error) => {
  console.error('实验失败:', error)
  process.exit(1)
})
