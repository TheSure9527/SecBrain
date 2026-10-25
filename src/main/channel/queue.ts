/**
 * 按会话分桶的队列：同一会话串行（保证回答顺序），不同会话并行。
 * 单聊场景每个用户一个桶；群聊场景每个「群 + 发言人」一个桶，互不排队。
 */
export class SessionQueue {
  private chains = new Map<string, Promise<void>>()

  push(sessionId: string, task: () => Promise<void>): void {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task).catch((err) => {
      console.warn(
        `[channel] 会话 ${sessionId} 处理失败:`,
        err instanceof Error ? err.message : err
      )
    })
    this.chains.set(sessionId, next)
    void next.finally(() => {
      if (this.chains.get(sessionId) === next) this.chains.delete(sessionId)
    })
  }

  /** 等待队列清空（测试用；不传 sessionId 等全部） */
  async drain(sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.chains.get(sessionId)
      return
    }
    await Promise.all([...this.chains.values()])
  }

  get pendingSessions(): number {
    return this.chains.size
  }
}
