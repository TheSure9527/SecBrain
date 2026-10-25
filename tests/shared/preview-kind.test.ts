import { describe, expect, it } from 'vitest'
import {
  isPreviewable,
  parseVaultFileUrl,
  previewKind,
  resolveRelativePath,
  vaultFileUrl
} from '../../src/shared/asset-url'

describe('previewKind', () => {
  it('json/代码/日志归为文本，csv 归为表格', () => {
    expect(previewKind('data.json')).toBe('text')
    expect(previewKind('脚本.py')).toBe('text')
    expect(previewKind('app.log')).toBe('text')
    expect(previewKind('表格.csv')).toBe('csv')
    expect(previewKind('表格.tsv')).toBe('csv')
  })

  it('Office 文档仍交给系统打开', () => {
    expect(previewKind('简历.docx')).toBeNull()
    expect(previewKind('报表.xlsx')).toBeNull()
  })

  it('识别图片', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']) {
      expect(previewKind(`a.${ext}`)).toBe('image')
    }
  })

  it('识别 PDF / 视频 / 音频', () => {
    expect(previewKind('文档.pdf')).toBe('pdf')
    expect(previewKind('a.mp4')).toBe('video')
    expect(previewKind('a.webm')).toBe('video')
    expect(previewKind('a.mp3')).toBe('audio')
    expect(previewKind('a.flac')).toBe('audio')
  })

  it('大小写不敏感', () => {
    expect(previewKind('A.PNG')).toBe('image')
    expect(previewKind('B.Pdf')).toBe('pdf')
  })

  it('其他类型不可预览', () => {
    expect(previewKind('a.docx')).toBeNull()
    expect(previewKind('a.zip')).toBeNull()
    expect(previewKind('a.md')).toBeNull()
    expect(isPreviewable('a.md')).toBe(false)
    expect(isPreviewable('a.png')).toBe(true)
  })
})

describe('vaultFileUrl / parseVaultFileUrl', () => {
  it('往返一致（含中文与空格）', () => {
    const path = '图片/我的 图.png'
    const url = vaultFileUrl(path)
    expect(url).toBe('secbrain-file://vault/%E5%9B%BE%E7%89%87/%E6%88%91%E7%9A%84%20%E5%9B%BE.png')
    expect(parseVaultFileUrl(url)).toBe(path)
  })

  it('非自定义协议返回 null', () => {
    expect(parseVaultFileUrl('https://x/a.png')).toBeNull()
  })
})

describe('resolveRelativePath', () => {
  it('相对笔记目录解析', () => {
    expect(resolveRelativePath('attachments/a.pdf', '日记/今天.md')).toBe('日记/attachments/a.pdf')
    expect(resolveRelativePath('../a.pdf', '日记/今天.md')).toBe('a.pdf')
  })

  it('绝对 URL 与锚点返回 null', () => {
    expect(resolveRelativePath('https://x/a.pdf', 'n.md')).toBeNull()
    expect(resolveRelativePath('#section', 'n.md')).toBeNull()
    expect(resolveRelativePath('', 'n.md')).toBeNull()
  })
})
