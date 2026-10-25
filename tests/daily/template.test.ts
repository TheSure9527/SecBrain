import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAILY_TEMPLATE,
  formatDate,
  renderTemplate
} from '../../src/main/daily/template'

const date = new Date(2026, 9, 23, 15, 4, 5) // 2026-10-23 周五 15:04:05

describe('formatDate', () => {
  it('常用占位符', () => {
    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2026-10-23')
    expect(formatDate(date, 'YYYY年MM月DD日')).toBe('2026年10月23日')
    expect(formatDate(date, 'HH:mm:ss')).toBe('15:04:05')
  })

  it('星期占位符', () => {
    expect(formatDate(date, 'ddd')).toBe('周五')
  })

  it('未知字符原样保留', () => {
    expect(formatDate(date, 'YYYY/MM abc')).toBe('2026/10 abc')
  })
})

describe('renderTemplate', () => {
  it('替换日期、时间、标题与星期', () => {
    const out = renderTemplate('# {{date}} {{weekday}} {{time}} {{title}}', {
      date,
      title: '2026-10-23'
    })
    expect(out).toBe('# 2026-10-23 周五 15:04 2026-10-23')
  })

  it('支持自定义日期格式', () => {
    const out = renderTemplate('{{date:YYYY年MM月DD日}}', { date, title: 'x' })
    expect(out).toBe('2026年10月23日')
  })

  it('cursor 占位替换为空', () => {
    expect(renderTemplate('前{{cursor}}后', { date, title: 'x' })).toBe('前后')
  })

  it('未知变量保持原样', () => {
    expect(renderTemplate('{{unknown}} {{date}}', { date, title: 'x' })).toBe(
      '{{unknown}} 2026-10-23'
    )
  })

  it('默认模板可被渲染', () => {
    const out = renderTemplate(DEFAULT_DAILY_TEMPLATE, { date, title: '2026-10-23' })
    expect(out).toContain('title: "2026-10-23"')
    expect(out).toContain('# 2026-10-23 周五')
    expect(out).toContain('## 待办')
    // 模板内不应残留未替换的日期变量
    expect(out).not.toContain('{{date}}')
  })
})
