/**
 * 渠道适配层契约（跨进程共享，只有定义没有实现）。
 * 适配器只做协议转换/验签/去重/ACK，不含任何业务判断。
 */

export type ChannelKind = 'desktop' | 'dingtalk' | 'wecom' | 'wechat'

export interface InboundAttachment {
  kind: 'image' | 'file' | 'audio'
  url?: string
  localPath?: string
  mimeType?: string
  name?: string
}

export interface InboundMessage {
  channel: ChannelKind
  /** 单聊还是群聊（群聊需 @ 机器人才会推送） */
  conversationType: 'single' | 'group'
  /** 群聊中是否真的 @ 了机器人 */
  mentioned?: boolean
  /** 平台消息 ID，幂等键 */
  channelMsgId: string
  userId: string
  userName?: string
  /** 单聊或群 ID */
  conversationId: string
  text: string
  attachments: InboundAttachment[]
  receivedAt: number
  /** 原始 payload，仅调试用 */
  raw?: unknown
}

export interface OutboundContent {
  text: string
  references?: Array<{ path: string; title: string }>
  /** 渠道是否支持 Markdown 渲染 */
  markdown?: boolean
}

/** 平台原始请求（webhook body / 长连接消息） */
export interface RawRequest {
  headers?: Record<string, string>
  body: unknown
}

export interface AckResponse {
  status: number
  body?: unknown
}

export interface ChannelAdapter {
  readonly kind: ChannelKind
  verify(req: RawRequest): Promise<boolean>
  /** 非消息事件（进群/已读/卡片回调）返回 null，显式忽略 */
  parse(req: RawRequest): Promise<InboundMessage | null>
  ack(): AckResponse
  send(conversationId: string, content: OutboundContent): Promise<void>
}

/** 会话隔离键：多渠道下防止上下文串台 */
export interface SessionKey {
  channel: ChannelKind
  conversationId: string
  userId: string
}

export function toSessionId(key: SessionKey): string {
  return `${key.channel}:${key.conversationId}:${key.userId}`
}


/** 渠道管理（设置页用） */
export interface ChannelStatusView {
  enabled: boolean
  connected: boolean
  clientId: string
  hasSecret: boolean
  boundUsers: string[]
  bindingCode: { code: string; expiresAt: number } | null
  error: string | null
}

export interface DingTalkConfigInputView {
  enabled: boolean
  clientId: string
  /** 留空表示不修改已保存的 Secret */
  clientSecret: string
}

export interface ChannelApi {
  status(): Promise<ChannelStatusView>
  saveDingTalk(input: DingTalkConfigInputView): Promise<ChannelStatusView>
  reconnect(): Promise<ChannelStatusView>
  generateBindingCode(): Promise<{ code: string; expiresAt: number }>
  unbind(userId: string): Promise<ChannelStatusView>
}
