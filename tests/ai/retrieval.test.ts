import { describe, expect, it } from 'vitest'
import { buildKnowledgeOverview, extractSearchTerms } from '../../src/main/ai/retrieval'

describe('extractSearchTerms', () => {
  it('中文按 2/3 字滑窗切词，剔除功能字', () => {
    const terms = extractSearchTerms('我是什么专业的学生', 10)
    expect(terms).toEqual(expect.arrayContaining(['专业', '学生']))
    expect(terms.some((t) => t.includes('帮我'))).toBe(false)
  })

  it('剔除指令短语后保留实质词', () => {
    const terms = extractSearchTerms('帮我总结一下时间管理的方法', 10)
    expect(terms).toEqual(expect.arrayContaining(['时间', '管理']))
    expect(terms.some((t) => t.includes('总结'))).toBe(false)
  })

  it('英文与数字整词保留', () => {
    const terms = extractSearchTerms('obsidian 双链 skill', 10)
    expect(terms).toContain('obsidian')
    expect(terms).toContain('skill')
  })

  it('多片段按顺序取词', () => {
    const terms = extractSearchTerms('番茄工作法 阅读 习惯', 12)
    expect(terms).toEqual(expect.arrayContaining(['番茄', '阅读', '习惯']))
  })

  it('去重并限制数量', () => {
    const terms = extractSearchTerms('时间管理 时间管理 阅读', 4)
    expect(terms.length).toBeLessThanOrEqual(4)
    expect(new Set(terms).size).toBe(terms.length)
  })

  it('纯疑问句返回空数组', () => {
    expect(extractSearchTerms('为什么？')).toEqual([])
  })
})

describe('buildKnowledgeOverview', () => {
  const notes = [
    {
      path: '工作/周报.md',
      title: '周报',
      tags: ['工作', '复盘'],
      updatedAt: '2026-10-20T10:00:00.000Z'
    },
    {
      path: '工作/项目计划.md',
      title: '项目计划',
      tags: ['工作'],
      updatedAt: '2026-10-21T10:00:00.000Z'
    },
    {
      path: '读书/时间管理.md',
      title: '时间管理',
      tags: ['读书', '效率'],
      updatedAt: '2026-10-18T10:00:00.000Z'
    },
    { path: '根笔记.md', title: '根笔记', tags: [], updatedAt: '2026-10-19T10:00:00.000Z' }
  ]

  it('包含总数、目录、标签与最近更新', () => {
    const text = buildKnowledgeOverview(notes)
    expect(text).toContain('共 4 篇 Markdown 笔记')
    expect(text).toContain('工作(2)')
    expect(text).toContain('读书(1)')
    expect(text).toContain('#工作(2)')
    expect(text).toContain('最近更新')
    // 最近更新按时间倒序，项目计划最新
    const recentSection = text.slice(text.indexOf('最近更新'))
    expect(recentSection.indexOf('项目计划')).toBeLessThan(recentSection.indexOf('周报'))
  })

  it('空知识库给出明确提示', () => {
    expect(buildKnowledgeOverview([])).toContain('还没有 Markdown 笔记')
  })

  it('告知材料数量（docx/pdf 等）', () => {
    const text = buildKnowledgeOverview(notes, 638)
    expect(text).toContain('638 份材料')
    expect(text).toContain('search_notes')
  })
})
