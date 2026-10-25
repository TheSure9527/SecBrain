/** 日记 / 模板共享类型 */

export interface DailyStat {
  /** YYYY-MM-DD */
  date: string
  notes: number
  tasks: number
}

export interface DailyApi {
  /** 打开某天的日记（不存在则按模板创建），date 为 YYYY-MM-DD 或缺省今天 */
  open(date?: string): Promise<{ path: string }>
  /** 近 N 天的笔记/任务活动统计（热图用） */
  stats(days?: number): Promise<DailyStat[]>
}
