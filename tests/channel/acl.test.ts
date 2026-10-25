import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applySchema } from '../../src/main/db/schema'
import { ChannelAcl } from '../../src/main/channel/acl'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

let db: ReturnType<typeof DatabaseSync>
let acl: ChannelAcl

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applySchema(db)
  acl = new ChannelAcl(db, 'dingtalk')
})

afterEach(() => db.close())

describe('ChannelAcl', () => {
  it('初始无绑定用户，任何人都不允许访问', () => {
    expect(acl.hasBoundUsers()).toBe(false)
    expect(acl.isAllowed('u1')).toBe(false)
  })

  it('生成绑定码 → 校验通过 → 用户被绑定', () => {
    const { code } = acl.generateBindingCode()
    expect(acl.tryBind('u1', code)).toBe(true)
    expect(acl.isBound('u1')).toBe(true)
    expect(acl.isAllowed('u1')).toBe(true)
    expect(acl.listBound()).toEqual(['u1'])
  })

  it('绑定码是一次性的（用过即失效）', () => {
    const { code } = acl.generateBindingCode()
    expect(acl.tryBind('u1', code)).toBe(true)
    expect(acl.tryBind('u2', code)).toBe(false)
    expect(acl.currentBindingCode()).toBeNull()
  })

  it('错误绑定码被拒绝', () => {
    const { code } = acl.generateBindingCode()
    const wrong = code === '123456' ? '654321' : '123456'
    expect(acl.tryBind('u1', wrong)).toBe(false)
    expect(acl.isBound('u1')).toBe(false)
  })

  it('过期绑定码被拒绝', () => {
    const { code } = acl.generateBindingCode(-1000)
    expect(acl.currentBindingCode()).toBeNull()
    expect(acl.tryBind('u1', code)).toBe(false)
  })

  it('可解绑已绑定用户', () => {
    const { code } = acl.generateBindingCode()
    acl.tryBind('u1', code)
    acl.unbind('u1')
    expect(acl.isBound('u1')).toBe(false)
    expect(acl.listBound()).toEqual([])
  })

  it('不同渠道的绑定互不影响', () => {
    const wecom = new ChannelAcl(db, 'wecom')
    const { code } = acl.generateBindingCode()
    acl.tryBind('u1', code)
    expect(acl.isBound('u1')).toBe(true)
    expect(wecom.isBound('u1')).toBe(false)
  })
})
