import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'
import { ChannelDedupStore } from '../../src/main/channel/dedup'
import { ChannelGateway } from '../../src/main/channel/gateway'
import { SessionQueue } from '../../src/main/channel/queue'
import type { ChannelAdapter, InboundMessage } from '../../src/shared/channel'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let dedup: ChannelDedupStore

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  dedup = new ChannelDedupStore(db)
})

afterEach(() => db.close())

const message = (msgId = 'm1'): InboundMessage => ({
  channel: 'dingtalk',
  conversationType: 'single',
  channelMsgId: msgId,
  userId: 'u1',
  conversationId: 'c1',
  text: '我是什么专业的学生',
  attachments: [],
  receivedAt: Date.now()
})

function makeAdapter(options: {
  valid?: boolean
  parsed?: InboundMessage | null
}): ChannelAdapter & { send: ReturnType<typeof vi.fn> } {
  return {
    kind: 'dingtalk',
    verify: async () => options.valid ?? true,
    parse: async () => (options.parsed === undefined ? message() : options.parsed),
    ack: () => ({ status: 200 }),
    send: vi.fn(async () => {})
  }
}

describe('ChannelDedupStore', () => {
  it('同一消息只标记一次', () => {
    expect(dedup.tryMark('dingtalk', 'm1')).toBe(true)
    expect(dedup.tryMark('dingtalk', 'm1')).toBe(false)
    expect(dedup.count()).toBe(1)
  })

  it('不同渠道的同名 msgId 互不影响', () => {
    expect(dedup.tryMark('dingtalk', 'm1')).toBe(true)
    expect(dedup.tryMark('wecom', 'm1')).toBe(true)
    expect(dedup.count()).toBe(2)
  })

  it('可清理过期记录', () => {
    dedup.tryMark('dingtalk', 'old', Date.now() - 10 * 24 * 3600 * 1000)
    dedup.tryMark('dingtalk', 'new')
    expect(dedup.prune()).toBe(1)
    expect(dedup.count()).toBe(1)
  })
})

describe('ChannelGateway', () => {
  it('正常消息：入队处理并回推结果', async () => {
    const handler = { handle: vi.fn(async () => ({ text: '回答' })) }
    const queue = new SessionQueue()
    const gateway = new ChannelGateway(dedup, handler, queue)
    const adapter = makeAdapter({})

    const ack = await gateway.receive(adapter, { body: {} })
    expect(ack.status).toBe(200)
    await queue.drain()

    expect(handler.handle).toHaveBeenCalledTimes(1)
    expect(adapter.send).toHaveBeenCalledWith('c1', { text: '回答' })
  })

  it('验签失败返回 401 且不处理', async () => {
    const handler = { handle: vi.fn(async () => ({ text: 'x' })) }
    const gateway = new ChannelGateway(dedup, handler, new SessionQueue())
    const ack = await gateway.receive(makeAdapter({ valid: false }), { body: {} })
    expect(ack.status).toBe(401)
    expect(handler.handle).not.toHaveBeenCalled()
  })

  it('非消息事件（parse 返回 null）直接 ACK', async () => {
    const handler = { handle: vi.fn(async () => ({ text: 'x' })) }
    const queue = new SessionQueue()
    const gateway = new ChannelGateway(dedup, handler, queue)
    const ack = await gateway.receive(makeAdapter({ parsed: null }), { body: {} })
    await queue.drain()
    expect(ack.status).toBe(200)
    expect(handler.handle).not.toHaveBeenCalled()
  })

  it('平台重试（同一 msgId）只处理一次', async () => {
    const handler = { handle: vi.fn(async () => ({ text: 'ok' })) }
    const queue = new SessionQueue()
    const gateway = new ChannelGateway(dedup, handler, queue)
    const adapter = makeAdapter({ parsed: message('dup-1') })

    await gateway.receive(adapter, { body: {} })
    await gateway.receive(adapter, { body: {} })
    await queue.drain()

    expect(handler.handle).toHaveBeenCalledTimes(1)
    expect(adapter.send).toHaveBeenCalledTimes(1)
  })

  it('处理抛错不影响后续消息', async () => {
    const handler = {
      handle: vi.fn(async () => {
        throw new Error('模型超时')
      })
    }
    const queue = new SessionQueue()
    const gateway = new ChannelGateway(dedup, handler, queue)
    await gateway.receive(makeAdapter({ parsed: message('e1') }), { body: {} })
    await expect(queue.drain()).resolves.toBeUndefined()
  })
})
