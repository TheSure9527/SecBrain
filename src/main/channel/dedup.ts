import type { DatabaseSync } from 'node:sqlite'
import type { ChannelKind } from '../../shared/channel'

/**
 * 渠道消息幂等表：平台超时重试会重复投递，同一 (channel, msgId) 只处理一次。
 */
export class ChannelDedupStore {
  constructor(private readonly db: DatabaseSync) {}

  /** 首次出现返回 true；重复消息返回 false */
  tryMark(channel: ChannelKind, msgId: string, now = Date.now()): boolean {
    const result = this.db
      .prepare(
        'INSERT OR IGNORE INTO channel_dedup (channel, channel_msg_id, processed_at) VALUES (?, ?, ?)'
      )
      .run(channel, msgId, now)
    return Number(result.changes) > 0
  }

  /** 清理过期记录（默认 7 天） */
  prune(olderThanMs = 7 * 24 * 3600 * 1000, now = Date.now()): number {
    const result = this.db
      .prepare('DELETE FROM channel_dedup WHERE processed_at < ?')
      .run(now - olderThanMs)
    return Number(result.changes)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM channel_dedup').get() as
      | { c: number }
      | undefined
    return row?.c ?? 0
  }
}
