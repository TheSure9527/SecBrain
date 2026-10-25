/** ID 生成（纯函数） */

/** 事件/任务等本地对象 id：时间戳 + 随机后缀，避免依赖数据库自增 */
export function randomId(prefix = 'secbrain'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
