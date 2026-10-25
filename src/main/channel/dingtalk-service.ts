import { safeStorage } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { toSessionId, type InboundMessage, type OutboundContent } from '../../shared/channel'
import { ChannelAcl } from './acl'
import { ChannelDedupStore } from './dedup'
import { ChannelGateway, type InboundHandler } from './gateway'
import { DingTalkAdapter } from './dingtalk-adapter'
import { SessionQueue } from './queue'

/**
 * 渠道层只依赖"对话用例"这个端口，不认识管家实现。
 * 装配层把 ButlerService 传进来即可（结构化类型满足）。
 */
export interface ChatUseCase {
  chat(
    text: string,
    sessionId: string
  ): Promise<{ text: string; references?: Array<{ path: string; title: string }> }>
}

export interface DingTalkConfigInput {
  enabled: boolean
  clientId: string
  /** 留空表示沿用已保存的 Secret */
  clientSecret: string
}

export interface ChannelStatus {
  enabled: boolean
  connected: boolean
  clientId: string
  hasSecret: boolean
  boundUsers: string[]
  bindingCode: { code: string; expiresAt: number } | null
  error: string | null
}

const KEY_ENABLED = 'channel.dingtalk.enabled'
const KEY_CLIENT_ID = 'channel.dingtalk.clientId'
const KEY_SECRET_ENC = 'channel.dingtalk.secret.enc'

/**
 * 钉钉单聊渠道服务：配置持久化 + Stream 连接生命周期 + 访问控制 + 交给管家处理。
 */
export class DingTalkService {
  private readonly acl: ChannelAcl
  private readonly queue = new SessionQueue()
  private gateway: ChannelGateway
  private adapter: DingTalkAdapter | null = null
  private client: { disconnect: () => void } | null = null
  private connected = false
  private lastError: string | null = null

  constructor(
    private readonly db: DatabaseSync,
    private readonly butler: ChatUseCase,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.acl = new ChannelAcl(db, 'dingtalk')
    const dedup = new ChannelDedupStore(db)
    this.gateway = new ChannelGateway(dedup, this.buildHandler(), this.queue)
  }

  // ---------- 配置 ----------

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

  getConfig(): { enabled: boolean; clientId: string; hasSecret: boolean } {
    return {
      enabled: this.getMeta(KEY_ENABLED) === '1',
      clientId: this.getMeta(KEY_CLIENT_ID) ?? '',
      hasSecret: Boolean(this.getMeta(KEY_SECRET_ENC))
    }
  }

  private readSecret(): string {
    const encrypted = this.getMeta(KEY_SECRET_ENC)
    if (!encrypted) return ''
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return ''
    }
  }

  async saveConfig(input: DingTalkConfigInput): Promise<ChannelStatus> {
    this.setMeta(KEY_ENABLED, input.enabled ? '1' : '0')
    this.setMeta(KEY_CLIENT_ID, input.clientId.trim())
    if (input.clientSecret.trim()) {
      const encrypted = safeStorage.encryptString(input.clientSecret.trim()).toString('base64')
      this.setMeta(KEY_SECRET_ENC, encrypted)
    }
    if (input.enabled) {
      await this.connect()
    } else {
      this.disconnect()
    }
    return this.status()
  }

  status(): ChannelStatus {
    return {
      ...this.getConfig(),
      connected: this.connected,
      boundUsers: this.acl.listBound(),
      bindingCode: this.acl.currentBindingCode(),
      error: this.lastError
    }
  }

  // ---------- 连接 ----------

  async connect(): Promise<ChannelStatus> {
    this.disconnect()
    const { clientId, enabled } = this.getConfig()
    const clientSecret = this.readSecret()
    if (!enabled) return this.status()
    if (!clientId || !clientSecret) {
      this.lastError = '缺少 ClientID / ClientSecret'
      return this.status()
    }

    try {
      const sdk = await import('dingtalk-stream')
      const adapter = new DingTalkAdapter({ clientId, clientSecret }, this.fetchImpl)
      const client = new sdk.DWClient({ clientId, clientSecret })

      client.registerCallbackListener(sdk.TOPIC_ROBOT, (message) => {
        let payload: unknown = null
        try {
          payload = JSON.parse(message.data)
        } catch {
          return
        }
        // 立刻 ACK，避免平台重试（重试会产生重复回答与重复计费）
        void this.gateway
          .receive(adapter, { body: payload })
          .then(() => client.socketCallBackResponse(message.headers.messageId, { status: 'SUCCESS' }))
          .catch((err) => {
            this.lastError = err instanceof Error ? err.message : String(err)
            client.socketCallBackResponse(message.headers.messageId, { status: 'LATER' })
          })
      })

      await client.connect()
      this.adapter = adapter
      this.client = client
      this.connected = true
      this.lastError = null
    } catch (err) {
      this.connected = false
      this.lastError = err instanceof Error ? err.message : String(err)
    }
    return this.status()
  }

  disconnect(): void {
    try {
      this.client?.disconnect()
    } catch {
      // 忽略断开异常
    }
    this.client = null
    this.adapter = null
    this.connected = false
  }

  // ---------- 访问控制 ----------

  generateBindingCode(): { code: string; expiresAt: number } {
    return this.acl.generateBindingCode()
  }

  unbind(userId: string): void {
    this.acl.unbind(userId)
  }

  // ---------- 消息处理 ----------

  private buildHandler(): InboundHandler {
    return {
      handle: async (message: InboundMessage): Promise<OutboundContent> => {
        if (!this.acl.isBound(message.userId)) {
          const code = message.text.trim()
          if (/^\d{6}$/.test(code) && this.acl.tryBind(message.userId, code)) {
            return { text: '✅ 绑定成功，现在可以直接问我日程、任务和笔记。' }
          }
          return {
            text:
              '请先在 myzsk 设置 → 钉钉机器人 中生成绑定码，然后把 6 位数字发给我完成绑定。\n' +
              '（知识库含私人内容，未绑定不予查询）'
          }
        }

        const reply = await this.butler.chat(
          message.text,
          toSessionId({
            channel: message.channel,
            conversationId: message.conversationId,
            userId: message.userId
          })
        )
        return { text: reply.text, references: reply.references, markdown: true }
      }
    }
  }

  /** 仅供测试：替换网关（注入假 handler） */
  setGateway(gateway: ChannelGateway): void {
    this.gateway = gateway
  }

  dispose(): void {
    this.disconnect()
  }
}
