import { describe, expect, it, vi } from 'vitest'
import {
  DingTalkAdapter,
  isBotMentioned,
  renderDingTalkMarkdown,
  stripMention,
  type DingTalkRobotPayload
} from '../../src/main/channel/dingtalk-adapter'

const credentials = { clientId: 'ding-abc', clientSecret: 'secret' }

function singlePayload(overrides: Partial<DingTalkRobotPayload> = {}): DingTalkRobotPayload {
  return {
    msgtype: 'text',
    msgId: 'msg-1',
    createAt: 1_700_000_000_000,
    conversationType: '1',
    conversationId: 'cid-single',
    senderId: 'sender-1',
    senderStaffId: 'staff-1',
    senderNick: '测试用户',
    text: { content: '我是什么专业的学生' },
    sessionWebhook: 'https://oapi.dingtalk.com/robot/webhook/xxx',
    sessionWebhookExpiredTime: Date.now() + 3600_000,
    ...overrides
  }
}

describe('stripMention / isBotMentioned', () => {
  it('剥离 @机器人 前缀（含钉钉特殊空格）', () => {
    expect(stripMention('@私人管家 我是什么专业的学生')).toBe('我是什么专业的学生')
    expect(stripMention('@私人管家\u2005今天有什么安排')).toBe('今天有什么安排')
  })

  it('识别是否 @ 了机器人', () => {
    expect(isBotMentioned({ isInAtList: true }, '@管家 hi')).toBe(true)
    expect(isBotMentioned({ atUsers: [{ dingtalkId: 'x' }] }, 'hi')).toBe(true)
    expect(isBotMentioned({}, '@管家 hi')).toBe(true)
    expect(isBotMentioned({}, '大家好')).toBe(false)
  })
})

describe('DingTalkAdapter.parse', () => {
  it('单聊消息直接解析，无需 @', async () => {
    const adapter = new DingTalkAdapter(credentials)
    const message = await adapter.parse({ body: singlePayload() })
    expect(message).toMatchObject({
      channel: 'dingtalk',
      conversationType: 'single',
      mentioned: true,
      channelMsgId: 'msg-1',
      userId: 'staff-1',
      userName: '测试用户',
      conversationId: 'cid-single',
      text: '我是什么专业的学生'
    })
    expect(message!.attachments).toEqual([])
  })

  it('群聊未 @ 机器人时忽略', async () => {
    const adapter = new DingTalkAdapter(credentials)
    const payload = singlePayload({
      conversationType: '2',
      conversationId: 'cid-group',
      text: { content: '大家上午好' },
      isInAtList: false,
      atUsers: []
    })
    expect(await adapter.parse({ body: payload })).toBeNull()
  })

  it('群聊 @ 机器人时清理前缀后解析', async () => {
    const adapter = new DingTalkAdapter(credentials)
    const payload = singlePayload({
      conversationType: '2',
      conversationId: 'cid-group',
      text: { content: '@私人管家 今天有什么安排' },
      isInAtList: true
    })
    const message = await adapter.parse({ body: payload })
    expect(message?.conversationType).toBe('group')
    expect(message?.text).toBe('今天有什么安排')
  })

  it('非文本消息被忽略', async () => {
    const adapter = new DingTalkAdapter(credentials)
    expect(await adapter.parse({ body: singlePayload({ msgtype: 'picture' }) })).toBeNull()
  })

  it('空文本与缺失会话被忽略', async () => {
    const adapter = new DingTalkAdapter(credentials)
    expect(await adapter.parse({ body: singlePayload({ text: { content: '   ' } }) })).toBeNull()
    expect(await adapter.parse({ body: singlePayload({ conversationId: '' }) })).toBeNull()
    expect(await adapter.parse({ body: null })).toBeNull()
  })

  it('凭证缺失时 verify 失败', async () => {
    const adapter = new DingTalkAdapter({ clientId: '', clientSecret: '' })
    expect(await adapter.verify({ body: {} })).toBe(false)
  })
})

describe('DingTalkAdapter.send', () => {
  it('优先使用 sessionWebhook 回推 markdown', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    const adapter = new DingTalkAdapter(credentials, fetchMock as unknown as typeof fetch)
    await adapter.parse({ body: singlePayload() })

    await adapter.send('cid-single', {
      text: '本科：计算机科学与技术',
      references: [{ path: '履历/简历.docx', title: '简历' }],
      markdown: true
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('dingtalk.com')
    const body = JSON.parse(String(init.body))
    expect(body.msgtype).toBe('markdown')
    expect(body.markdown.text).toContain('计算机科学与技术')
    expect(body.markdown.text).toContain('参考：简历')
  })

  it('webhook 过期时回退到开放平台 API', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('accessToken')) {
        return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })
    const adapter = new DingTalkAdapter(credentials, fetchMock as unknown as typeof fetch)
    await adapter.parse({
      body: singlePayload({ sessionWebhookExpiredTime: Date.now() - 1000 })
    })

    await adapter.send('cid-single', { text: '你好' })

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('accessToken'))).toBe(true)
    expect(urls.some((url) => url.includes('oToMessages'))).toBe(true)
  })
})

describe('renderDingTalkMarkdown', () => {
  it('把引用追加到消息末尾', () => {
    const { title, text } = renderDingTalkMarkdown({
      text: '第一行\n第二行',
      references: [
        { path: 'a.md', title: '笔记A' },
        { path: 'b.md', title: '笔记B' }
      ]
    })
    expect(title).toBe('第一行')
    expect(text).toContain('参考：笔记A、笔记B')
  })
})
