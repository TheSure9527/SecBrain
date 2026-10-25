/** 工具执行器的共用格式化 */

export function eventSummaryLine(event: {
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  location?: string
}): string {
  if (event.allDay) return `全天「${event.title}」(${event.startAt})`
  const time = (iso: string): string =>
    new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `「${event.title}」${time(event.startAt)} - ${time(event.endAt)}${event.location ? ` @${event.location}` : ''}`
}
