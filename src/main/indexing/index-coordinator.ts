/**
 * 索引协调器：全文 / 属性 / 链接 / 向量 的唯一失效入口。
 *
 * 应用层只与 coordinator 交互，新增一种索引 = 实现 IndexProvider 并注册。
 */

export interface DocSnapshot {
  /** 文档标识（当前用 vault 相对路径，保证幂等） */
  docId: string
  /** 原始路径或外部 ID */
  sourceId: string
  text: string
  meta: Record<string, unknown>
  updatedAt: number
}

export interface IndexProvider {
  readonly name: string
  upsert(doc: DocSnapshot): Promise<void>
  invalidate(docId: string): Promise<void>
  rebuildAll?(): Promise<void>
}

export class IndexPartialFailure extends Error {
  constructor(readonly failed: string[]) {
    super(`索引更新部分失败：${failed.join('、')}`)
    this.name = 'IndexPartialFailure'
  }
}

export class IndexCoordinator {
  private lastFailures: string[] = []

  constructor(private readonly providers: IndexProvider[]) {}

  /** 最近一次失败的 provider 名称（空数组表示健康） */
  get failures(): string[] {
    return [...this.lastFailures]
  }

  async onChanged(doc: DocSnapshot): Promise<void> {
    await this.fanout((provider) => provider.upsert(doc))
  }

  async onDeleted(docId: string): Promise<void> {
    await this.fanout((provider) => provider.invalidate(docId))
  }

  /** 全量重建（切换 Vault、手动重建时用） */
  async rebuildAll(docs: DocSnapshot[]): Promise<void> {
    await this.fanout(async (provider) => {
      if (provider.rebuildAll) {
        await provider.rebuildAll()
        return
      }
      for (const doc of docs) await provider.upsert(doc)
    })
  }

  /**
   * 并行扇出：单个 provider 失败不阻断其余，但失败清单必须抛出。
   * 索引是最终一致场景，可以重试，但不能不知道失败。
   */
  private async fanout(op: (provider: IndexProvider) => Promise<void>): Promise<void> {
    const results = await Promise.allSettled(this.providers.map((provider) => op(provider)))
    const failed = results
      .map((result, index) => (result.status === 'rejected' ? this.providers[index]!.name : null))
      .filter((name): name is string => name !== null)
    this.lastFailures = failed
    if (failed.length > 0) {
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          console.warn(
            `[index] ${this.providers[index]!.name} 更新失败:`,
            result.reason instanceof Error ? result.reason.message : result.reason
          )
        }
      }
      throw new IndexPartialFailure(failed)
    }
  }
}
