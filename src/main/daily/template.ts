/** 模板变量渲染（纯函数） */

const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const pad = (n: number): string => String(n).padStart(2, '0')

export interface TemplateVars {
  date: Date
  title: string
}

/** 支持 YYYY / MM / DD / HH / mm / ss / ddd 占位符 */
export function formatDate(date: Date, pattern: string): string {
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss|ddd/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear())
      case 'MM':
        return pad(date.getMonth() + 1)
      case 'DD':
        return pad(date.getDate())
      case 'HH':
        return pad(date.getHours())
      case 'mm':
        return pad(date.getMinutes())
      case 'ss':
        return pad(date.getSeconds())
      case 'ddd':
        return WEEKDAYS_CN[date.getDay()]!
      default:
        return token
    }
  })
}

/**
 * 渲染模板变量：
 * - `{{date}}` 日期（YYYY-MM-DD）
 * - `{{date:YYYY年MM月DD日}}` 自定义格式
 * - `{{time}}` 当前时间（HH:mm）
 * - `{{title}}` 笔记标题
 * - `{{weekday}}` 星期几
 * - `{{cursor}}` 光标位置（替换为空，插入后由编辑器定位）
 * 未知变量原样保留。
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_match, format?: string) =>
      formatDate(vars.date, format?.trim() || 'YYYY-MM-DD')
    )
    .replace(/\{\{time\}\}/g, formatDate(vars.date, 'HH:mm'))
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{weekday\}\}/g, WEEKDAYS_CN[vars.date.getDay()]!)
    .replace(/\{\{cursor\}\}/g, '')
}

/** 默认日记模板（未配置模板文件时使用） */
export const DEFAULT_DAILY_TEMPLATE = `---
title: "{{date}}"
tags: [日记]
created: {{date}}
---

# {{date}} {{weekday}}

## 记录

## 待办
- [ ]
`
