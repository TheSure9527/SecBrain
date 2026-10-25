import type {
  AckResponse,
  ChannelAdapter,
  ChannelKind,
  InboundMessage,
  OutboundContent,
  RawRequest
} from '../../shared/channel'

/** 钉钉机器人回调（Stream 模式推送的 data） */
export interface DingTalkRobotPayload {
  msgtype?: string
  msgId?: string
  createAt?: number
  /** '1' 单聊，'2' 群聊 */
  conversationType?: string
  conversationId?: string
  conversationTitle?: string
  senderId?: string
  senderStaffId?: string
  senderNick?: string
  chatbotUserId?: string
  robotCode?: string
  sessionWebhook?: string
  sessionWebhookExpiredTime?: number
  isInAtList?: boolean
  atUsers?: Array<{ dingtalkId?: string; staffId?: string }>
  text?: { content?: string }
}

export interface DingTalkCredentials {
  clientId: string
  clientSecret: string
}

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken'
const OTO_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend'
const GROUP_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send'

/** 去掉 @机器人 前缀（钉钉用 \u2005 作 @ 后的空格） */
export function stripMention(text: string): string {
  return text.replace(/^(?:@[^\s\u2005]+[\s\u2005]*)+/, '').trim()
}

/** 群聊里是否真的 @ 了机器人 */
export function isBotMentioned(payload: DingTalkRobotPayload, text: string): boolean {
  if (payload.isInAtList) return true
  if ((payload.atUsers?.length ?? 0) > 0) return true
  return /^@/.test(text.trim())
}

export function renderDingTalkMarkdown(content: OutboundContent): {
  title: string
  text: string
} {
  const title = content.text.split('\n')[0]?.slice(0, 40) || '管家回复'
  const refs =
    content.references && content.references.length > 0
      ? `\n\n> 参考：${content.references.map((r) => r.title).join('、')}`
      : ''
  return { title, text: `${content.text}${refs}` }
}

/**
 * 钉钉适配器（单聊为主，兼容群聊 @）。
 * - 只做协议转换、@ 清洗、回复投递，不含任何业务判断
 * - 回复优先用消息自带的 sessionWebhook（免申请发送权限），过期后回退到开放平台 API
 */
export class DingTalkAdapter implements ChannelAdapter {
  readonly kind: ChannelKind = 'dingtalk'
  private readonly webhooks = new Map<string, { url: string; expiresAt: number }>()
  /** conversationId → 对方 userId（API 兜底回复需要） */
  private readonly peers = new Map<string, string>()
  private token: { value: string; expiresAt: number } | null = null

  constructor(
    private readonly credentials: DingTalkCredentials,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** Stream 长连接已在握手阶段鉴权，这里只校验凭证是否齐全 */
  async verify(): Promise<boolean> {
    return Boolean(this.credentials.clientId && this.credentials.clientSecret)
  }

  async parse(req: RawRequest): Promise<InboundMessage | null> {
    const payload = req.body as DingTalkRobotPayload | null
    if (!payload || typeof payload !== 'object') return null

    // 非文本消息（图片/文件/卡片回调）先忽略，避免污染会话
    if ((payload.msgtype ?? 'text') !== 'text') return null

    const rawText = payload.text?.content?.trim() ?? ''
    if (!rawText) return null

    const isGroup = payload.conversationType === '2'
    const mentioned = isGroup ? isBotMentioned(payload, rawText) : true
    // 群里没 @ 机器人的消息不处理
    if (isGroup && !mentioned) return null

    const text = isGroup ? stripMention(rawText) : rawText
    if (!text) return null

    const conversationId = payload.conversationId ?? ''
    if (!conversationId) return null
    const userId = payload.senderStaffId || payload.senderId || ''
    if (!userId) return null

    if (payload.sessionWebhook && payload.sessionWebhookExpiredTime) {
      this.webhooks.set(conversationId, {
        url: payload.sessionWebhook,
        expiresAt: payload.sessionWebhookExpiredTime
      })
      this.peers.set(conversationId, userId)
    }

    return {
      channel: 'dingtalk',
      conversationType: isGroup ? 'group' : 'single',
      mentioned,
      channelMsgId: payload.msgId ?? `${conversationId}-${payload.createAt ?? Date.now()}`,
      userId,
      userName: payload.senderNick,
      conversationId,
      text,
      attachments: [],
      receivedAt: payload.createAt ?? Date.now(),
      raw: payload
    }
  }

  ack(): AckResponse {
    return { status: 200 }
  }

  async send(conversationId: string, content: OutboundContent): Promise<void> {
    const markdown = renderDingTalkMarkdown(content)
    const webhook = this.webhooks.get(conversationId)
    if (webhook && webhook.expiresAt > Date.now()) {
      const ok = await this.post(webhook.url, {
        msgtype: 'markdown',
        markdown
      })
      if (ok) return
      this.webhooks.delete(conversationId)
    }
    await this.sendViaApi(conversationId, markdown)
  }

  // ---------- 内部 ----------

  private async post(url: string, body: unknown): Promise<boolean> {
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      return res.ok
    } catch {
      return false
    }
  }

  private async accessToken(): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value
    try {
      const res = await this.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appKey: this.credentials.clientId,
          appSecret: this.credentials.clientSecret
        })
      })
      if (!res.ok) return null
      const data = (await res.json()) as { accessToken?: string; expireIn?: number }
      if (!data.accessToken) return null
      this.token = {
        value: data.accessToken,
        expiresAt: Date.now() + (data.expireIn ?? 7200) * 1000
      }
      return this.token.value
    } catch {
      return null
    }
  }

  /** sessionWebhook 过期后的兜底：走开放平台机器人 API */
  private async sendViaApi(
    conversationId: string,
    markdown: { title: string; text: string }
  ): Promise<void> {
    const token = await this.accessToken()
    if (!token) throw new Error('钉钉 accessToken 获取失败')

    const peer = this.peers.get(conversationId)
    const isGroup = !peer
    const url = isGroup ? GROUP_SEND_URL : OTO_SEND_URL
    const body = isGroup
      ? {
          robotCode: this.credentials.clientId,
          openConversationId: conversationId,
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify(markdown)
        }
      : {
          robotCode: this.credentials.clientId,
          userIds: [peer],
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify(markdown)
        }

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-acs-dingtalk-access-token': token
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      throw new Error(`钉钉消息发送失败（HTTP ${res.status}）`)
    }
  }
}
