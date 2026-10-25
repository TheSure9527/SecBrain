/** 日历视图共用的日期工具 */

export function toDateStamp(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 存储戳（全天日期或 ISO UTC）→ 本地 Date */
export function stampToDate(stamp: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return new Date(`${stamp}T00:00:00`)
  return new Date(stamp)
}

export function formatTime(stamp: string): string {
  const d = stampToDate(stamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateStamp(a) === toDateStamp(b)
}

/** 月视图矩阵：6 行 × 7 列，周日起 */
export function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(start.getDate() - start.getDay())
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w += 1) {
    const week: Date[] = []
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      week.push(day)
    }
    weeks.push(week)
  }
  return weeks
}

/** 周视图：周一起的 7 天 */
export function weekDates(date: Date): Date[] {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

/** 本地日期 + 时分 → ISO UTC */
export function localToUtcIso(dateStamp: string, time: string): string {
  return new Date(`${dateStamp}T${time}:00`).toISOString()
}

/** ISO UTC → 本地日期 + 时分 */
export function utcIsoToLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: toDateStamp(d),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}
