#!/usr/bin/env node
/**
 * 分层依赖检查（可执行的架构规则）
 *
 * 图层编号：0 渠道适配 · 1 表现层 · 2 应用层 · 3 智能体层 · 4 领域层 · 5 基础设施
 * 规则：
 *   1. 只能依赖「同层或更低层」，智能体层(3)允许调用应用层(2)的用例
 *   2. 领域层/基础设施层不得运行时依赖上层
 *   3. 跨域引用必须走域出口（../<domain>），不得深挖 ../<domain>/<file>
 *   4. 不允许循环依赖
 * 仅检查 `import type` 之外的运行时依赖。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, dirname } from 'node:path'

const ROOT = resolve(process.cwd(), 'src/main')

/** 单文件级别的层级覆盖（未命中则按目录推断） */
const FILE_LAYER = {
  'vault/vault.ts': 5,
  'vault/note-file.ts': 5,
  'vault/note-index.ts': 5,
  'vault/link-graph.ts': 4,
  'vault/props.ts': 4,
  'vault/notes-service.ts': 2,
  'calendar/ical.ts': 5,
  'calendar/event-store.ts': 5,
  'calendar/caldav-client.ts': 5,
  'calendar/conflict.ts': 4,
  'calendar/ports.ts': 4,
  'calendar/sync-engine.ts': 2,
  'calendar/scheduler.ts': 2,
  'calendar/calendar-service.ts': 2,
  'tasks/task-store.ts': 5,
  'tasks/task-service.ts': 2,
  'semantic/chunker.ts': 4,
  'semantic/embedding.ts': 5,
  'semantic/semantic-service.ts': 2,
  'indexer/doc-extract.ts': 5,
  'indexer/document-index.ts': 2,
  'query/query-parser.ts': 4,
  'query/query-executor.ts': 2,
  'daily/template.ts': 4,
  'daily/daily-service.ts': 2,
  'ai/provider.ts': 3,
  'ai/tools.ts': 3,
  'ai/butler-service.ts': 3,
  'ai/search.ts': 4,
  'ai/retrieval.ts': 4,
  'settings/settings-service.ts': 5,
  'db/database.ts': 5,
  'db/schema.ts': 5,
  'domain/time.ts': 4,
  'index.ts': 1,
  'ipc/register.ts': 1
}

const DIR_LAYER = { channel: 0, channels: 0, domain: 4 }

function layerOf(relPath) {
  if (FILE_LAYER[relPath] !== undefined) return FILE_LAYER[relPath]
  const top = relPath.split('/')[0]
  if (DIR_LAYER[top] !== undefined) return DIR_LAYER[top]
  return 2
}

const ALLOWED = {
  0: new Set([0, 2]),
  1: new Set([0, 1, 2, 3, 4, 5]),
  2: new Set([2, 3, 4, 5]),
  3: new Set([2, 3, 4, 5]),
  4: new Set([4]),
  5: new Set([4, 5])
}

/** 收集所有 ts 文件 */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const IMPORT_RE = /^\s*(import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm

const files = await walk(ROOT)
const rel = (abs) => relative(ROOT, abs)
const fileSet = new Set(files)
const graph = new Map()
const violations = []
const deepImports = []

for (const file of files) {
  const relPath = rel(file)
  const layer = layerOf(relPath)
  const source = await readFile(file, 'utf8')
  const deps = []
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[2]
    if (!spec.startsWith('.')) continue
    let target = resolve(dirname(file), spec)
    if (!target.endsWith('.ts')) target += '.ts'
    target = target.replace(/\/index\.ts$/, '/index.ts')
    if (!fileSet.has(target)) {
      // 指向目录（index.ts）的情况
      const asIndex = resolve(dirname(file), spec, 'index.ts')
      if (fileSet.has(asIndex)) target = asIndex
      else continue
    }
    deps.push(target)
    const targetRel = rel(target)
    const targetLayer = layerOf(targetRel)

    // 规则 1/2：依赖方向
    if (!ALLOWED[layer].has(targetLayer)) {
      violations.push(
        `层级违规  L${layer} ${relPath}  →  L${targetLayer} ${targetRel}`
      )
    }

    // 规则 3：跨域必须走域出口
    const sameDomain = relPath.split('/')[0] === targetRel.split('/')[0]
    if (!sameDomain && relPath !== 'index.ts' && !targetRel.endsWith('/index.ts')) {
      deepImports.push(`深层导入  ${relPath}  →  ${targetRel}`)
    }
  }
  graph.set(file, deps)
}

// 规则 4：循环依赖
const cycles = []
const state = new Map() // 0 未访问 1 访问中 2 完成
const stack = []
function dfs(node) {
  state.set(node, 1)
  stack.push(node)
  for (const dep of graph.get(node) ?? []) {
    const s = state.get(dep) ?? 0
    if (s === 0) dfs(dep)
    else if (s === 1) {
      const start = stack.indexOf(dep)
      cycles.push([...stack.slice(start), dep].map(rel).join(' → '))
    }
  }
  stack.pop()
  state.set(node, 2)
}
for (const file of files) if (!state.get(file)) dfs(file)

const report = []
if (violations.length) report.push(['层级违规', violations])
if (deepImports.length) report.push(['跨域深层导入', deepImports])
if (cycles.length) report.push(['循环依赖', [...new Set(cycles)]])

if (report.length === 0) {
  console.log(`✓ 分层检查通过：${files.length} 个文件，无层级违规、无循环依赖、无跨域深层导入`)
  process.exit(0)
}

for (const [title, items] of report) {
  console.log(`\n✗ ${title}（${items.length}）`)
  for (const item of items.slice(0, 30)) console.log('  - ' + item)
  if (items.length > 30) console.log(`  … 其余 ${items.length - 30} 条省略`)
}
process.exit(1)
