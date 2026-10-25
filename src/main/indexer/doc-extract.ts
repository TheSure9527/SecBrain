import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

/** 纯文本类扩展名：直接读取 */
export const TEXT_EXTS = new Set([
  'txt',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'ts',
  'js',
  'mjs',
  'py',
  'sh',
  'css',
  'scss',
  'sql',
  'ini',
  'conf',
  'toml'
])

/** 二进制文档：需要专用解析器 */
export const BINARY_DOC_EXTS = new Set(['docx', 'pdf', 'xlsx', 'xls', 'pptx', 'pages', 'numbers', 'key'])

/** 可参与索引的扩展名 */
export const INDEXABLE_EXTS = new Set([...TEXT_EXTS, ...BINARY_DOC_EXTS])

const MB = 1024 * 1024

/** 分类型体积上限：文档类可放宽（文本提取只取前 20 万字） */
const SIZE_LIMITS: Record<string, number> = {
  docx: 120 * MB,
  doc: 120 * MB,
  pdf: 80 * MB,
  xlsx: 120 * MB,
  xls: 120 * MB,
  pptx: 120 * MB
}
const DEFAULT_SIZE_LIMIT = 5 * MB
const MAX_TEXT_CHARS = 200_000

export function sizeLimitFor(ext: string): number {
  return SIZE_LIMITS[ext] ?? DEFAULT_SIZE_LIMIT
}

/** 人工可读的跳过原因 */
export function describeSkip(ext: string, sizeBytes: number): string {
  const limit = sizeLimitFor(ext)
  if (sizeBytes > limit) {
    return `文件过大（${Math.round(sizeBytes / MB)}MB，上限 ${Math.round(limit / MB)}MB）`
  }
  if (ext === 'pages' || ext === 'numbers' || ext === 'key') return `格式暂不支持（${ext}，Apple iWork）`
  if (!INDEXABLE_EXTS.has(ext)) return `格式暂不支持（${ext}）`
  return '未提取到文本（可能是扫描件、加密或文件损坏）'
}

/** 解析 XML/HTML 实体 */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** 归一化提取出的文本：去控制字符、折叠空白 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS)
}

export function extOf(path: string): string {
  return extname(path).slice(1).toLowerCase()
}

export function isIndexableFile(path: string): boolean {
  return INDEXABLE_EXTS.has(extOf(path))
}

/**
 * 提取文档正文：
 * - 文本类：直接读 UTF-8
 * - docx：mammoth 提取纯文本
 * - pdf：pdf-parse 提取文本层
 * - xlsx/xls：SheetJS 转 CSV 文本
 * - pptx/pages/numbers/key：暂不支持（返回 null）
 */
export async function extractDocumentText(absPath: string, ext = extOf(absPath)): Promise<string | null> {
  try {
    const info = await stat(absPath)
    if (!info.isFile() || info.size > sizeLimitFor(ext)) return null
  } catch {
    return null
  }

  try {
    if (TEXT_EXTS.has(ext)) {
      const raw = await readFile(absPath, 'utf8')
      const text = normalizeText(raw)
      return text.length > 0 ? text : null
    }

    if (ext === 'docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: absPath })
      const text = normalizeText(result.value)
      return text.length > 0 ? text : null
    }

    if (ext === 'pdf') {
      // pdf-parse v2：new PDFParse({ data }).getText()
      type PdfParserCtor = new (options: { data: Uint8Array }) => {
        getText: () => Promise<{ text: string }>
        destroy: () => Promise<void>
      }
      const mod = (await import('pdf-parse')) as unknown as {
        PDFParse?: PdfParserCtor
        default?: { PDFParse?: PdfParserCtor }
      }
      const PDFParse = mod.PDFParse ?? mod.default?.PDFParse
      if (!PDFParse) throw new Error('pdf-parse 不可用')
      const buffer = await readFile(absPath)
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      try {
        const result = await parser.getText()
        const text = normalizeText(result.text ?? '')
        return text.length > 0 ? text : null
      } finally {
        await parser.destroy().catch(() => undefined)
      }
    }

    if (ext === 'pptx') {
      // pptx = zip（ppt/slides/slideN.xml），提取每页 <a:t> 文本
      const JSZip = (await import('jszip')).default
      const buffer = await readFile(absPath)
      const zip = await JSZip.loadAsync(buffer)
      const slideNames = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0))
      const parts: string[] = []
      for (const [index, name] of slideNames.entries()) {
        const file = zip.file(name)
        if (!file) continue
        const xml = await file.async('string')
        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
          decodeXml(m[1] ?? '').trim()
        )
        const joined = texts.filter(Boolean).join(' ')
        if (joined) parts.push(`# 第 ${index + 1} 页\n${joined}`)
      }
      const text = normalizeText(parts.join('\n\n'))
      return text.length > 0 ? text : null
    }

    if (ext === 'xlsx' || ext === 'xls') {
      // CJS 包在 ESM 动态导入下导出可能挂在 default 上
      const mod = (await import('xlsx')) as unknown as {
        default?: typeof import('xlsx')
        readFile?: typeof import('xlsx').readFile
      }
      const xlsx = (mod.readFile ? mod : mod.default) as typeof import('xlsx')
      const book = xlsx.readFile(absPath, { cellDates: true })
      const parts: string[] = []
      for (const name of book.SheetNames.slice(0, 20)) {
        const sheet = book.Sheets[name]
        if (!sheet) continue
        parts.push(`# ${name}`, xlsx.utils.sheet_to_csv(sheet, { blankrows: false }))
      }
      const text = normalizeText(parts.join('\n\n'))
      return text.length > 0 ? text : null
    }

    return null
  } catch (err) {
    // 解析失败（加密、损坏、格式变种）：记录后可排查
    console.warn(
      `[docs] 提取失败 ${ext} ${absPath}: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}
