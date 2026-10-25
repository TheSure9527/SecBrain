import {
  toSessionId,
  type AckResponse,
  type ChannelAdapter,
  type InboundMessage,
  type OutboundContent,
  type RawRequest
} from '../../shared/channel'
import type { ChannelDedupStore } from './dedup'
import { SessionQueue } from './queue'

/** 业务处理方：由应用层实现（把 InboundMessage 转成用例调用） */
export interface InboundHandler {
  handle(message: InboundMessage): Promise<OutboundContent>
}

export interface InboundQueue {
  push(sessionId: string, task: () => Promise<void>): void
}

/**
 * 渠道网关：验签 → 解析 → 幂等 → 入队 → 立刻 ACK。
 * 同步处理会让平台超时重试，导致重复回答与重复计费。
 */
export class ChannelGateway {
  constructor(
    private readonly dedup: ChannelDedupStore,
    private readonly handler: InboundHandler,
    private readonly queue: InboundQueue = new SessionQueue()
  ) {}

  async receive(adapter: ChannelAdapter, req: RawRequest): Promise<AckResponse> {
    if (!(await adapter.verify(req))) {
      return { status: 401, body: { error: 'invalid signature' } }
    }
    const message = await adapter.parse(req)
    if (!message) return adapter.ack()

    // 重复投递：直接 ACK，不重复执行
    if (!this.dedup.tryMark(message.channel, message.channelMsgId)) {
      return adapter.ack()
    }

    const sessionId = toSessionId({
      channel: message.channel,
      conversationId: message.conversationId,
      userId: message.userId
    })
    this.queue.push(sessionId, () => this.process(adapter, message))
    return adapter.ack()
  }

  private async process(adapter: ChannelAdapter, message: InboundMessage): Promise<void> {
    const reply = await this.handler.handle(message)
    await adapter.send(message.conversationId, reply)
  }
}
