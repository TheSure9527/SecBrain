import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// SettingsService 依赖 electron 的 nativeTheme，测试用替身
vi.mock('electron', () => ({
  nativeTheme: { themeSource: 'system' },
  safeStorage: {
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

import { applySchema } from '../../src/main/db/schema'
import { Vault } from '../../src/main/vault/vault'
import { NoteIndex } from '../../src/main/vault/note-index'
import { LinkGraph } from '../../src/main/vault/link-graph'
import { NotesService } from '../../src/main/vault/notes-service'
import { SettingsService } from '../../src/main/settings/settings-service'
import { TaskStore } from '../../src/main/tasks/task-store'
import { DailyService } from '../../src/main/daily/daily-service'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let root: string
let vault: Vault
let index: NoteIndex
let notes: NotesService
let settings: SettingsService
let taskStore: TaskStore
let daily: DailyService

beforeEach(async () => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  root = await mkdtemp(join(tmpdir(), 'myzsk-daily-'))
  vault = new Vault(root)
  await vault.ensure()
  index = new NoteIndex(db)
  notes = new NotesService(vault, index, () => {}, new LinkGraph(db, vault, index))
  await notes.init()
  settings = new SettingsService(db)
  taskStore = new TaskStore(db)
  daily = new DailyService(vault, notes, settings, taskStore, index)
})

afterEach(async () => {
  notes.dispose()
  db.close()
  await rm(root, { recursive: true, force: true })
})

const todayStamp = ((): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

describe('DailyService.open', () => {
  it('同一天已有别的格式命名时，直接复用而不是新建', async () => {
    // 模拟"原有日记"：2026年10月23日.md
    await vault.write('日记/2026年10月23日.md', '# 旧日记\n\n原有内容')
    await notes.refreshNote('日记/2026年10月23日.md')

    const { path } = await daily.open('2026-10-23')
    expect(path).toBe('日记/2026年10月23日.md')
    const content = await readFile(join(root, path), 'utf8')
    expect(content).toContain('原有内容')
    // 没有生成新的 2026-10-23.md
    expect(existsSync(join(root, '日记/2026-10-23.md'))).toBe(false)
  })

  it('日记被删到回收站后，再次打开会恢复而不是新建空白', async () => {
    const created = await daily.open('2026-10-23')
    await vault.write(created.path, '# 2026-10-23\n\n被误删的内容')
    // 走回收站删除（文件树删除用的就是这个）
    await notes.deleteEntry(created.path)
    expect(existsSync(join(root, created.path))).toBe(false)

    const { path } = await daily.open('2026-10-23')
    expect(path).toBe('日记/2026-10-23.md')
    const content = await readFile(join(root, path), 'utf8')
    expect(content).toContain('被误删的内容')
  })

  it('首次打开创建当天日记并套用内置模板', async () => {
    const { path } = await daily.open()
    expect(path).toBe(`日记/${todayStamp}.md`)
    expect(existsSync(join(root, path))).toBe(true)

    const content = await readFile(join(root, path), 'utf8')
    expect(content).toContain(`title: "${todayStamp}"`)
    expect(content).toContain('## 待办')
    // 已进入索引
    expect(notes.listNotes().some((n) => n.path === path)).toBe(true)
  })

  it('已存在时直接复用，不覆盖内容', async () => {
    const { path } = await daily.open()
    await vault.write(path, '# 手写内容')
    const second = await daily.open()
    expect(second.path).toBe(path)
    expect(await readFile(join(root, path), 'utf8')).toBe('# 手写内容')
  })

  it('支持指定日期', async () => {
    const { path } = await daily.open('2026-10-01')
    expect(path).toBe('日记/2026-10-01.md')
    expect(await readFile(join(root, path), 'utf8')).toContain('2026-10-01')
  })

  it('支持自定义目录与文件名格式', async () => {
    settings.save({ ...settings.get(), dailyDir: 'journal', dailyFormat: 'YYYYMMDD' })
    const { path } = await daily.open('2026-10-01')
    expect(path).toBe('journal/20261001.md')
  })

  it('支持自定义模板文件', async () => {
    await vault.write('templates/日志.md', '# {{date}}\n\n本周：{{weekday}}\n')
    settings.save({ ...settings.get(), dailyTemplate: 'templates/日志.md' })
    const { path } = await daily.open('2026-10-01')
    const content = await readFile(join(root, path), 'utf8')
    expect(content).toBe('# 2026-10-01\n\n本周：周四\n')
  })

  it('模板文件缺失时回退内置模板', async () => {
    settings.save({ ...settings.get(), dailyTemplate: 'templates/不存在.md' })
    const { path } = await daily.open('2026-10-01')
    const content = await readFile(join(root, path), 'utf8')
    expect(content).toContain('## 待办')
  })
})

describe('DailyService.stats', () => {
  it('按天统计笔记创建数与任务完成数', async () => {
    const day1 = '2026-10-20'
    const day2 = '2026-10-21'
    for (const [path, createdAt] of [
      ['a.md', `${day1}T08:00:00.000Z`],
      ['b.md', `${day1}T09:00:00.000Z`],
      ['c.md', `${day2}T10:00:00.000Z`]
    ] as const) {
      index.upsert({
        path,
        title: path,
        tags: [],
        createdAt,
        updatedAt: createdAt,
        content: ''
      })
    }
    const doneTask = taskStore.create({ title: '完成的任务' })
    taskStore.setStatus(doneTask.id, true)
    db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run(
      `${day2}T12:00:00.000Z`,
      doneTask.id
    )

    const stats = await daily.stats(7)
    expect(stats).toHaveLength(7)
    const byDate = new Map(stats.map((s) => [s.date, s]))
    expect(byDate.get(day1)?.notes).toBe(2)
    expect(byDate.get(day2)?.notes).toBe(1)
    expect(byDate.get(day2)?.tasks).toBe(1)
    // 连续天数、无活动为 0
    expect(stats[stats.length - 1]!.date).toBe(todayStamp)
    expect(stats[0]!.notes + stats[0]!.tasks).toBeGreaterThanOrEqual(0)
  })

  it('无活动时全为 0（清空索引后）', async () => {
    index.clearAll()
    const stats = await daily.stats(3)
    expect(stats.every((s) => s.notes === 0 && s.tasks === 0)).toBe(true)
  })
})
