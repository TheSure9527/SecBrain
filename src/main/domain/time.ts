/** 时间领域的纯规则（零 IO，可单测） */

/** 全天事件用日期戳（YYYY-MM-DD）表示，否则用 ISO 时间 */
export function isAllDayStamp(stamp: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(stamp)
}

/** 本地日期戳 */
export function toDateStamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 存储戳 → Date（日期戳按本地零点） */
export function stampToDate(stamp: string): Date {
  return isAllDayStamp(stamp) ? new Date(`${stamp}T00:00:00`) : new Date(stamp)
}
