import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'
import { parseQuery } from '../../src/main/query/query-parser'
import { QueryExecutor } from '../../src/main/query/query-executor'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

describe('parseQuery', () => {
  it('解析完整查询', () => {
    const spec = parseQuery(
      'FROM #读书\nWHERE status = "未完成" AND rating >= 4\nSORT due ASC\nTABLE title, status, rating\nLIMIT 5'
    )
    expect(spec).toEqual({
      from: { kind: 'tag', value: '读书' },
      where: [
        { key: 'status', op: '=', value: '未完成' },
        { key: 'rating', op: '>=', value: '4' }
      ],
      sort: { key: 'due', dir: 'ASC' },
      columns: ['title', 'status', 'rating'],
      limit: 5
    })
  })

  it('FROM 文件夹与默认值', () => {
    expect(parseQuery('FROM "笔记/读书"')).toMatchObject({
      from: { kind: 'folder', value: '笔记/读书' },
      where: [],
      columns: ['title'],
      limit: 50
    })
  })

  it('LIST 只取标题', () => {
    const spec = parseQuery('LIST')
    expect('error' in spec).toBe(false)
    if (!('error' in spec)) expect(spec.columns).toEqual(['title'])
  })

  it('DESC 排序', () => {
    const spec = parseQuery('SORT rating DESC')
    if (!('error' in spec)) expect(spec.sort).toEqual({ key: 'rating', dir: 'DESC' })
  })

  it('非法语句报错', () => {
    expect(parseQuery('HELLO WORLD')).toHaveProperty('error')
    expect(parseQuery('LIMIT abc')).toHaveProperty('error')
    expect(parseQuery('WHERE 没有操作符')).toHaveProperty('error')
    expect(parseQuery('FROM #')).toHaveProperty('error')
  })
})

describe('QueryExecutor', () => {
  let db: ReturnType<typeof DatabaseSync>
  let executor: QueryExecutor

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applySchema(db)
    executor = new QueryExecutor(db)

    const addNote = (
      path: string,
      title: string,
      tags: string[],
      props: Array<{ key: string; value: string; type: string }>
    ): void => {
      db.prepare(
        'INSERT INTO notes (path, title, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(path, title, JSON.stringify(tags), '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
      for (const prop of props) {
        db.prepare(
          'INSERT INTO note_props (path, key, value, value_type) VALUES (?, ?, ?, ?)'
        ).run(path, prop.key, prop.value, prop.type)
      }
    }

    addNote('读书/深入理解.md', '深入理解计算机系统', ['读书'], [
      { key: 'status', value: '已完成', type: 'string' },
      { key: 'rating', value: '5', type: 'number' }
    ])
    addNote('读书/代码大全.md', '代码大全', ['读书'], [
      { key: 'status', value: '未完成', type: 'string' },
      { key: 'rating', value: '4', type: 'number' }
    ])
    addNote('读书/人月神话.md', '人月神话', ['读书'], [
      { key: 'status', value: '未完成', type: 'string' },
      { key: 'rating', value: '3', type: 'number' }
    ])
    addNote('工作/周报.md', '周报', ['工作'], [])
  })

  afterEach(() => db.close())

  it('按标签筛选 + 条件过滤 + 排序', () => {
    const result = executor.run(
      'FROM #读书\nWHERE status = "未完成"\nSORT rating DESC\nTABLE title, rating'
    )
    expect(result.error).toBeUndefined()
    expect(result.columns).toEqual(['title', 'rating'])
    expect(result.rows).toEqual([
      { title: '代码大全', rating: '4' },
      { title: '人月神话', rating: '3' }
    ])
  })

  it('数值比较 >=', () => {
    const result = executor.run('WHERE rating >= 4\nSORT rating ASC\nTABLE title, rating')
    expect(result.rows.map((r) => r.title)).toEqual(['代码大全', '深入理解计算机系统'])
  })

  it('按文件夹筛选', () => {
    const result = executor.run('FROM "工作"\nTABLE title')
    expect(result.rows).toEqual([{ title: '周报' }])
  })

  it('contains 模糊匹配', () => {
    const result = executor.run('WHERE title contains "大全"\nTABLE title')
    expect(result.rows).toEqual([{ title: '代码大全' }])
  })

  it('!= 与缺省字段', () => {
    const result = executor.run('FROM #读书\nWHERE status != "未完成"\nTABLE title')
    expect(result.rows).toEqual([{ title: '深入理解计算机系统' }])
  })

  it('LIMIT 生效', () => {
    const result = executor.run('FROM #读书\nSORT rating DESC\nLIMIT 2')
    expect(result.rows).toHaveLength(2)
  })

  it('无法解析时返回 error 且不抛错', () => {
    const result = executor.run('随便写点什么')
    expect(result.error).toBeTruthy()
    expect(result.rows).toHaveLength(0)
  })
})
