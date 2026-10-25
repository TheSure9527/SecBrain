import { afterEach, describe, expect, it, vi } from 'vitest'
import { ButlerService } from '../../src/main/ai/butler-service'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString()
  }
}))

const stubServices = {
  calendar: { listCalendars: () => [], getEvents: () => [] },
  tasks: { list: () => [], counts: () => ({ today: 0, week: 0, all: 0, done: 0 }) },
  notes: { searchNotes: () => [], listNotes: () => [] },
  semantic: null,
  documents: null
} as never

function makeService(): ButlerService {
  const db = new DatabaseSync(':memory:')
  applySchema(db)
  return new ButlerService(db, stubServices)
}

afterEach(() => vi.unstubAllGlobals())

describe('本地模型探测', () => {
  it('发现 Ollama 时返回地址与模型列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('11434')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'qwen2.5:7b' }] })
          } as unknown as Response
        }
        throw new Error('ECONNREFUSED')
      })
    )
    const result = await makeService().probeLocal()
    expect(result.found).toBe(true)
    expect(result.baseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(result.models).toEqual(['qwen2.5:7b'])
    expect(result.attempts?.[0]?.error).toBeNull()
  })

  it('全部不可用时返回尝试明细，便于界面提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    const result = await makeService().probeLocal()
    expect(result.found).toBe(false)
    expect(result.attempts).toHaveLength(3)
    expect(result.attempts?.every((item) => item.error?.includes('未启动'))).toBe(true)
  })
})
