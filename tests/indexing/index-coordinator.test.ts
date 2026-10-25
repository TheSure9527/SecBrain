import { describe, expect, it, vi } from 'vitest'
import {
  IndexCoordinator,
  IndexPartialFailure,
  type DocSnapshot,
  type IndexProvider
} from '../../src/main/indexing'

const snapshot = (id: string): DocSnapshot => ({
  docId: id,
  sourceId: id,
  text: '正文',
  meta: {},
  updatedAt: Date.now()
})

function makeProvider(name: string, failing = false): IndexProvider {
  return {
    name,
    upsert: vi.fn(async () => {
      if (failing) throw new Error(`${name} 挂了`)
    }),
    invalidate: vi.fn(async () => {
      if (failing) throw new Error(`${name} 挂了`)
    })
  }
}

describe('IndexCoordinator', () => {
  it('变更时扇出到全部 provider', async () => {
    const a = makeProvider('fts')
    const b = makeProvider('links')
    const c = makeProvider('semantic')
    const coordinator = new IndexCoordinator([a, b, c])

    await coordinator.onChanged(snapshot('a.md'))

    for (const provider of [a, b, c]) {
      expect(provider.upsert).toHaveBeenCalledTimes(1)
      expect(provider.upsert).toHaveBeenCalledWith(expect.objectContaining({ docId: 'a.md' }))
    }
    expect(coordinator.failures).toEqual([])
  })

  it('删除时扇出 invalidate', async () => {
    const a = makeProvider('fts')
    const b = makeProvider('links')
    await new IndexCoordinator([a, b]).onDeleted('a.md')
    expect(a.invalidate).toHaveBeenCalledWith('a.md')
    expect(b.invalidate).toHaveBeenCalledWith('a.md')
  })

  it('单个 provider 失败不阻断其余，但抛出失败清单', async () => {
    const ok = makeProvider('fts')
    const broken = makeProvider('semantic', true)
    const coordinator = new IndexCoordinator([ok, broken])

    await expect(coordinator.onChanged(snapshot('a.md'))).rejects.toBeInstanceOf(IndexPartialFailure)
    // 其余 provider 仍然执行
    expect(ok.upsert).toHaveBeenCalledTimes(1)
    expect(coordinator.failures).toEqual(['semantic'])
  })

  it('失败信息包含 provider 名称', async () => {
    const broken = makeProvider('link-graph', true)
    const coordinator = new IndexCoordinator([broken])
    await expect(coordinator.onChanged(snapshot('a.md'))).rejects.toThrow(/link-graph/)
  })

  it('rebuildAll 优先调用 provider 的重建方法', async () => {
    const rebuildAll = vi.fn(async () => {})
    const provider: IndexProvider = {
      name: 'fts',
      upsert: vi.fn(async () => {}),
      invalidate: vi.fn(async () => {}),
      rebuildAll
    }
    const coordinator = new IndexCoordinator([provider])
    await coordinator.rebuildAll([snapshot('a.md')])
    expect(rebuildAll).toHaveBeenCalledTimes(1)
    expect(provider.upsert).not.toHaveBeenCalled()
  })
})
