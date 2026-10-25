import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import {
  describeSkip,
  extractDocumentText,
  sizeLimitFor
} from '../../src/main/indexer/doc-extract'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'myzsk-pptx-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 构造一个最小 pptx（zip + ppt/slides/slideN.xml） */
async function makePptx(path: string, slides: string[]): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  slides.forEach((text, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:a="a"><a:p><a:t>${text}</a:t></a:p></p:sld>`
    )
  })
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  await writeFile(path, buffer)
}

describe('pptx 提取', () => {
  it('按页提取文本', async () => {
    const path = join(root, '答辩.pptx')
    await makePptx(path, ['开题报告', '研究背景 &amp; 方法'])
    const text = await extractDocumentText(path)
    expect(text).toContain('# 第 1 页')
    expect(text).toContain('开题报告')
    expect(text).toContain('研究背景 & 方法')
  })

  it('空演示文稿返回 null', async () => {
    const path = join(root, '空.pptx')
    await makePptx(path, [])
    expect(await extractDocumentText(path)).toBeNull()
  })
})

describe('体积上限与跳过原因', () => {
  it('文档类上限更宽松', () => {
    expect(sizeLimitFor('docx')).toBe(120 * 1024 * 1024)
    expect(sizeLimitFor('pdf')).toBe(80 * 1024 * 1024)
    expect(sizeLimitFor('txt')).toBe(5 * 1024 * 1024)
  })

  it('给出可读原因', () => {
    expect(describeSkip('docx', 200 * 1024 * 1024)).toContain('文件过大')
    expect(describeSkip('pages', 1024)).toContain('iWork')
    expect(describeSkip('pdf', 1024)).toContain('扫描件')
  })
})
