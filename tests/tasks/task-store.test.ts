import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'
import { TaskStore } from '../../src/main/tasks/task-store'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let store: TaskStore

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  store = new TaskStore(db)
})

afterEach(() => db.close())

const local = (y: number, m: number, d: number, h = 0, mi = 0): string =>
  new Date(y, m - 1, d, h, mi).toISOString()

describe('TaskStore CRUD', () => {
  it('创建任务带默认值', () => {
    const task = store.create({ title: '写周报' })
    expect(task.title).toBe('写周报')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe(0)
    expect(task.tags).toEqual([])
    expect(task.dueAt).toBeNull()
    expect(task.notePath).toBeNull()
    expect(task.eventId).toBeNull()
    expect(task.completedAt).toBeNull()
    expect(task.id).toMatch(/^task-/)
  })

  it('创建任务带全部字段', () => {
    const task = store.create({
      title: '买牛奶',
      notes: '保质期注意',
      dueAt: '2026-10-25',
      allDay: true,
      priority: 3,
      tags: ['生活', '采购'],
      notePath: '购物清单.md'
    })
    expect(task.dueAt).toBe('2026-10-25')
    expect(task.allDay).toBe(true)
    expect(task.priority).toBe(3)
    expect(task.tags).toEqual(['生活', '采购'])
    expect(task.notePath).toBe('购物清单.md')
  })

  it('更新只改提供的字段', () => {
    const task = store.create({ title: '原标题', notes: '备注', priority: 1 })
    const updated = store.update({ id: task.id, title: '新标题' })
    expect(updated.title).toBe('新标题')
    expect(updated.notes).toBe('备注')
    expect(updated.priority).toBe(1)
  })

  it('更新不存在的任务抛错', () => {
    expect(() => store.update({ id: 'nope', title: 'x' })).toThrow()
  })

  it('完成 / 重新打开', () => {
    const task = store.create({ title: '可完成' })
    const done = store.setStatus(task.id, true)
    expect(done.status).toBe('done')
    expect(done.completedAt).not.toBeNull()
    const reopened = store.setStatus(task.id, false)
    expect(reopened.status).toBe('todo')
    expect(reopened.completedAt).toBeNull()
  })

  it('删除后不可读', () => {
    const task = store.create({ title: '待删' })
    store.delete(task.id)
    expect(store.getById(task.id)).toBeNull()
  })

  it('setEventLink 记录日程关联', () => {
    const task = store.create({ title: '转日程' })
    store.setEventLink(task.id, 'cal-1::uid-1')
    expect(store.getById(task.id)!.eventId).toBe('cal-1::uid-1')
  })
})

describe('TaskStore 筛选', () => {
  const today = ((): string => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })()
  const tomorrow = ((): string => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })()
  const nextWeek = ((): string => {
    const d = new Date()
    d.setDate(d.getDate() + 5)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })()
  const far = ((): string => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })()
  const yesterday = ((): string => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })()

  beforeEach(() => {
    store.create({ title: '今天', dueAt: today })
    store.create({ title: '明天', dueAt: tomorrow })
    store.create({ title: '下周', dueAt: nextWeek })
    store.create({ title: '远', dueAt: far })
    store.create({ title: '逾期', dueAt: yesterday })
    store.create({ title: '无截止' })
    const doneTask = store.create({ title: '已完成', dueAt: today })
    store.setStatus(doneTask.id, true)
  })

  it('today 含逾期与今天，排除已完成', () => {
    const titles = store.list('today').map((t) => t.title)
    expect(titles).toContain('今天')
    expect(titles).toContain('逾期')
    expect(titles).not.toContain('明天')
    expect(titles).not.toContain('已完成')
  })

  it('week 含 7 天内', () => {
    const titles = store.list('week').map((t) => t.title)
    expect(titles).toEqual(expect.arrayContaining(['今天', '明天', '下周', '逾期']))
    expect(titles).not.toContain('远')
    expect(titles).not.toContain('已完成')
  })

  it('all 含全部未完成', () => {
    const titles = store.list('all').map((t) => t.title)
    expect(titles).toHaveLength(6)
    expect(titles).not.toContain('已完成')
  })

  it('done 只含已完成', () => {
    const titles = store.list('done').map((t) => t.title)
    expect(titles).toEqual(['已完成'])
  })

  it('排序：有截止的按日期升序，无截止排最后', () => {
    const titles = store.list('all').map((t) => t.title)
    expect(titles[titles.length - 1]).toBe('无截止')
    expect(titles.indexOf('逾期')).toBeLessThan(titles.indexOf('今天'))
    expect(titles.indexOf('今天')).toBeLessThan(titles.indexOf('明天'))
  })

  it('同日任务按优先级降序', () => {
    const low = store.create({ title: '低优', dueAt: today, priority: 1 })
    store.create({ title: '高优', dueAt: today, priority: 3 })
    const titles = store
      .list('all')
      .filter((t) => t.dueAt === today)
      .map((t) => t.title)
    expect(titles.indexOf('高优')).toBeLessThan(titles.indexOf('低优'))
    expect(low.priority).toBe(1)
  })

  it('counts 各筛选计数正确', () => {
    const counts = store.counts()
    expect(counts.today).toBe(2) // 今天 + 逾期
    expect(counts.week).toBe(4) // 今天/明天/下周/逾期
    expect(counts.all).toBe(6)
    expect(counts.done).toBe(1)
  })
})

describe('TaskStore 到期检测', () => {
  it('窗口内的待办任务被检出', () => {
    const task = store.create({ title: '到点', dueAt: local(2026, 10, 23, 10) })
    const due = store.dueTasks(new Date(2026, 9, 23, 10, 0, 30))
    expect(due.map((t) => t.id)).toEqual([task.id])
  })

  it('未到点或超出窗口不检出', () => {
    store.create({ title: '未来', dueAt: local(2026, 10, 23, 10) })
    expect(store.dueTasks(new Date(2026, 9, 23, 9, 59))).toHaveLength(0)
    expect(store.dueTasks(new Date(2026, 9, 23, 10, 5))).toHaveLength(0)
  })

  it('已完成与无截止任务不检出', () => {
    const done = store.create({ title: '已完成', dueAt: local(2026, 10, 23, 10) })
    store.setStatus(done.id, true)
    store.create({ title: '无截止' })
    expect(store.dueTasks(new Date(2026, 9, 23, 10, 0, 30))).toHaveLength(0)
  })

  it('全天任务在当天 9 点到期', () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const task = store.create({ title: '全天', dueAt: stamp, allDay: true })
    expect(store.dueTasks(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 59))).toHaveLength(0)
    const due = store.dueTasks(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 30))
    expect(due.map((t) => t.id)).toEqual([task.id])
  })
})
