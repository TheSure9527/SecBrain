import { describe, expect, it } from 'vitest'
import { SessionQueue } from '../../src/main/channel/queue'

describe('SessionQueue', () => {
  it('同一会话内串行执行', async () => {
    const queue = new SessionQueue()
    const events: string[] = []
    const task = (name: string) => async (): Promise<void> => {
      events.push(`start-${name}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      events.push(`end-${name}`)
    }
    queue.push('a', task('1'))
    queue.push('a', task('2'))
    await queue.drain('a')
    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('不同会话并行执行', async () => {
    const queue = new SessionQueue()
    const events: string[] = []
    const task = (name: string) => async (): Promise<void> => {
      events.push(`start-${name}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
      events.push(`end-${name}`)
    }
    queue.push('a', task('a'))
    queue.push('b', task('b'))
    await queue.drain()
    // 并行：两个 start 都在各自的 end 之前
    expect(events.indexOf('start-b')).toBeLessThan(events.indexOf('end-a'))
  })

  it('单个会话失败不影响后续任务', async () => {
    const queue = new SessionQueue()
    const done: string[] = []
    queue.push('a', async () => {
      throw new Error('boom')
    })
    queue.push('a', async () => {
      done.push('second')
    })
    await queue.drain('a')
    expect(done).toEqual(['second'])
  })

  it('会话队列在处理完后回收', async () => {
    const queue = new SessionQueue()
    queue.push('a', async () => {})
    await queue.drain('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queue.pendingSessions).toBe(0)
  })
})
