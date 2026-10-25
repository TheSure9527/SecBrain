import * as chrono from 'chrono-node'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDateTime(input: unknown, ref: Date = new Date()): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const text = input.trim()
  if (ISO_RE.test(text)) return new Date(text).toISOString()
  if (DATE_RE.test(text)) return text

  // 自然语言：先试简体中文解析器，再试英文默认解析器
  const zhResult = chrono.zh.hans.parse(text, ref, { forwardDate: true })[0]
  const result = zhResult ?? chrono.parse(text, ref, { forwardDate: true })[0]
  if (!result) return null
  const date = result.date()
  // 解析结果含具体时刻（时分）→ ISO；仅日期 → 日期戳
  const hasTime = result.start.get('hour') !== null || result.start.get('minute') !== null
  if (!hasTime && date.getHours() === 0 && date.getMinutes() === 0) {
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${m}-${d}`
  }
  return date.toISOString()
}

