import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extOf,
  extractDocumentText,
  isIndexableFile,
  normalizeText
} from '../../src/main/indexer/doc-extract'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'secbrain-doc-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('extOf / isIndexableFile', () => {
  it('识别扩展名', () => {
    expect(extOf('简历.DOCX')).toBe('docx')
    expect(extOf('a/b.pdf')).toBe('pdf')
    expect(extOf('无扩展名')).toBe('')
  })

  it('可索引类型', () => {
    expect(isIndexableFile('简历.docx')).toBe(true)
    expect(isIndexableFile('报表.xlsx')).toBe(true)
    expect(isIndexableFile('说明.txt')).toBe(true)
    expect(isIndexableFile('图片.png')).toBe(false)
    expect(isIndexableFile('演示.pptx')).toBe(true)
  })
})

describe('extractDocumentText', () => {
  it('读取纯文本文件', async () => {
    const path = join(root, 'note.txt')
    await writeFile(path, '第一行\n\n\n\n第二行  ')
    const text = await extractDocumentText(path)
    expect(text).toBe('第一行\n\n第二行')
  })

  it('识别 CSV 内容', async () => {
    const path = join(root, 'data.csv')
    await writeFile(path, '姓名,年龄\n张三,30')
    const text = await extractDocumentText(path)
    expect(text).toContain('张三')
  })

  it('不支持的扩展名返回 null', async () => {
    const path = join(root, 'image.png')
    await writeFile(path, 'not really png')
    expect(await extractDocumentText(path)).toBeNull()
  })

  it('文件不存在返回 null', async () => {
    expect(await extractDocumentText(join(root, 'missing.docx'))).toBeNull()
  })

  it('损坏的 docx 不抛错', async () => {
    const path = join(root, 'broken.docx')
    await writeFile(path, 'this is not a zip')
    expect(await extractDocumentText(path)).toBeNull()
  })
})

describe('normalizeText', () => {
  it('折叠空白与换行、去控制字符', () => {
    expect(normalizeText('a  b\n\n\n\nc\u0000d')).toBe('a b\n\nc d')
  })

  it('超长文本截断', () => {
    const long = 'x'.repeat(300_000)
    expect(normalizeText(long).length).toBe(200_000)
  })
})
