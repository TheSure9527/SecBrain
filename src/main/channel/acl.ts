import type { DatabaseSync } from 'node:sqlite'
import type { ChannelKind } from '../../shared/channel'

interface BindingRow {
  user_id: string
  created_at: number
}

/**
 * 渠道访问控制：绑定码 + 已绑定用户白名单。
 *
 * 机器人可以被任何人拉进群，而知识库里有日记、简历、薪资等隐私内容，
 * 因此必须在渠道层做单点控制（不是企业级 ACL，只有"单一主体 + 白名单"）。
 */
export class ChannelAcl {
  constructor(
    private readonly db: DatabaseSync,
    private readonly channel: ChannelKind
  ) {}

  private metaKey(suffix: string): string {
    return `channel.${this.channel}.${suffix}`
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  }

  private deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  }

  /** 尚未绑定任何用户时，第一条消息可以凭绑定码完成绑定 */
  hasBoundUsers(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM channel_bindings WHERE channel = ?')
      .get(this.channel) as { c: number } | undefined
    return (row?.c ?? 0) > 0
  }

  isBound(userId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM channel_bindings WHERE channel = ? AND user_id = ?')
      .get(this.channel, userId)
    return Boolean(row)
  }

  listBound(): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM channel_bindings WHERE channel = ? ORDER BY created_at')
      .all(this.channel) as unknown as BindingRow[]
    return rows.map((row) => row.user_id)
  }

  /** 生成一次性绑定码（默认 10 分钟有效） */
  generateBindingCode(ttlMs = 10 * 60 * 1000): { code: string; expiresAt: number } {
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expiresAt = Date.now() + ttlMs
    this.setMeta(this.metaKey('binding.code'), code)
    this.setMeta(this.metaKey('binding.expiresAt'), String(expiresAt))
    return { code, expiresAt }
  }

  currentBindingCode(): { code: string; expiresAt: number } | null {
    const code = this.getMeta(this.metaKey('binding.code'))
    const expiresAt = Number(this.getMeta(this.metaKey('binding.expiresAt')) ?? 0)
    if (!code || !expiresAt || expiresAt < Date.now()) return null
    return { code, expiresAt }
  }

  /** 校验并消费绑定码 */
  tryBind(userId: string, code: string): boolean {
    const current = this.currentBindingCode()
    if (!current || current.code !== code.trim()) return false
    this.bind(userId)
    this.deleteMeta(this.metaKey('binding.code'))
    this.deleteMeta(this.metaKey('binding.expiresAt'))
    return true
  }

  bind(userId: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO channel_bindings (channel, user_id, created_at) VALUES (?, ?, ?)'
      )
      .run(this.channel, userId, Date.now())
  }

  unbind(userId: string): void {
    this.db
      .prepare('DELETE FROM channel_bindings WHERE channel = ? AND user_id = ?')
      .run(this.channel, userId)
  }

  /** 消息是否允许访问（已绑定用户） */
  isAllowed(userId: string): boolean {
    return this.isBound(userId)
  }
}
