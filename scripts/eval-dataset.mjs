#!/usr/bin/env node
/**
 * 评测集自检（数据质量，不跑检索）
 *
 * 校验三件事：
 *   1. mustHit 里的路径在库里真实存在（documents 或 notes）
 *   2. fact 题的 mustContain 关键词确实出现在这些文件的正文里
 *   3. no-answer 题的 absentKeywords 在整库中确实 0 命中（保证"真的没有"）
 *
 * 用法：node scripts/eval-dataset.mjs [questions.json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const localPath = 'tests/eval/questions.local.json'
const examplePath = 'tests/eval/questions.example.json'
const datasetPath = process.argv[2] ?? (existsSync(localPath) ? localPath : examplePath)
const isExample = datasetPath.endsWith('.example.json')
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))
const dbPath = join(homedir(), 'Library/Application Support/secbrain/secbrain.db')
const db = new DatabaseSync(dbPath, { readOnly: true })

const docStmt = db.prepare('SELECT text FROM documents WHERE path = ?')
const noteStmt = db.prepare('SELECT title, tags FROM notes WHERE path = ?')
const noteContentStmt = db.prepare('SELECT content FROM notes_fts WHERE path = ?')

function exists(path) {
  return Boolean(docStmt.get(path) || noteStmt.get(path))
}

function textOf(path) {
  const doc = docStmt.get(path)
  if (doc?.text) return doc.text
  const fts = noteContentStmt.get(path)
  return fts?.content ?? ''
}

function corpusCount(keyword) {
  const a = db.prepare('SELECT COUNT(*) c FROM documents WHERE text LIKE ?').get(`%${keyword}%`).c
  const b = db
    .prepare('SELECT COUNT(*) c FROM notes_fts WHERE content LIKE ? OR title LIKE ?')
    .get(`%${keyword}%`, `%${keyword}%`).c
  return a + b
}

const failures = []
const byType = new Map()

for (const item of dataset.items) {
  byType.set(item.type, (byType.get(item.type) ?? 0) + 1)

  for (const path of item.mustHit) {
    if (!exists(path)) failures.push(`${item.id} 路径不存在：${path}`)
  }

  if (item.type === 'fact') {
    if (!item.mustHit.length) failures.push(`${item.id} 事实题必须指定 mustHit`)
    if (!item.mustContain?.length) failures.push(`${item.id} 事实题必须指定 mustContain`)
    const text = item.mustHit.map(textOf).join('\n')
    for (const keyword of item.mustContain ?? []) {
      if (!text.includes(keyword)) {
        failures.push(`${item.id} mustContain 未命中：${keyword}（目标文件正文里没有）`)
      }
    }
  }

  if (item.type === 'no-answer') {
    for (const keyword of item.absentKeywords ?? []) {
      const count = corpusCount(keyword)
      if (count > 0) {
        failures.push(`${item.id} 拒答题关键词「${keyword}」在库中出现 ${count} 次，可能不该是拒答题`)
      }
    }
  }
}

const total = dataset.items.length
console.log(`评测集：${datasetPath}`)
console.log(`总数 ${total} — ` + [...byType.entries()].map(([k, v]) => `${k}:${v}`).join(' · '))

if (failures.length === 0) {
  console.log('✓ 数据质量检查通过：路径真实、关键词可验证、拒答题确实无答案')
  process.exit(0)
}

console.log(`\n✗ 发现 ${failures.length} 个问题：`)
for (const failure of failures) console.log('  - ' + failure)
process.exit(1)
