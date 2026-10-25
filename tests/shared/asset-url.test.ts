import { describe, expect, it } from 'vitest'
import { resolveAssetUrl, rewriteImageSources } from '../../src/shared/asset-url'

describe('resolveAssetUrl', () => {
  it('根目录笔记的相对路径', () => {
    expect(resolveAssetUrl('attachments/a.png', '笔记.md')).toBe(
      'myzsk-file://vault/attachments/a.png'
    )
  })

  it('子目录笔记的相对路径基于笔记目录解析', () => {
    expect(resolveAssetUrl('attachments/a.png', '日记/今天.md')).toBe(
      'myzsk-file://vault/%E6%97%A5%E8%AE%B0/attachments/a.png'
    )
  })

  it('处理 ../ 上级引用', () => {
    expect(resolveAssetUrl('../images/a.png', '日记/今天.md')).toBe(
      'myzsk-file://vault/images/a.png'
    )
  })

  it('处理 ./ 当前目录', () => {
    expect(resolveAssetUrl('./a.png', '日记/今天.md')).toBe(
      'myzsk-file://vault/%E6%97%A5%E8%AE%B0/a.png'
    )
  })

  it('中文与空格路径被编码', () => {
    expect(resolveAssetUrl('图片/我的 图.png', '笔记.md')).toBe(
      'myzsk-file://vault/%E5%9B%BE%E7%89%87/%E6%88%91%E7%9A%84%20%E5%9B%BE.png'
    )
  })

  it('绝对 URL 原样返回', () => {
    expect(resolveAssetUrl('https://example.com/a.png', 'n.md')).toBe('https://example.com/a.png')
    expect(resolveAssetUrl('data:image/png;base64,AAA', 'n.md')).toBe('data:image/png;base64,AAA')
    expect(resolveAssetUrl('/abs/a.png', 'n.md')).toBe('/abs/a.png')
    expect(resolveAssetUrl('#anchor', 'n.md')).toBe('#anchor')
  })

  it('空值原样返回', () => {
    expect(resolveAssetUrl('', 'n.md')).toBe('')
  })
})

describe('rewriteImageSources', () => {
  it('重写相对路径 img src', () => {
    const html = '<p><img src="attachments/a.png" alt="图"></p>'
    expect(rewriteImageSources(html, '日记/今天.md')).toBe(
      '<p><img src="myzsk-file://vault/%E6%97%A5%E8%AE%B0/attachments/a.png" alt="图"></p>'
    )
  })

  it('不改动绝对 URL 与 data URL', () => {
    const html = '<img src="https://x/a.png"><img src="data:image/png;base64,AAA">'
    expect(rewriteImageSources(html, 'n.md')).toBe(html)
  })

  it('无图片时原样返回', () => {
    const html = '<p>纯文本</p>'
    expect(rewriteImageSources(html, 'n.md')).toBe(html)
  })
})
