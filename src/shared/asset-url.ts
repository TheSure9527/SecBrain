/**
 * 资源路径解析：把笔记中的相对路径转换为渲染进程可加载的 myzsk-file:// URL。
 */

const ABSOLUTE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'csv' | null

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const CSV_EXTS = new Set(['csv', 'tsv'])
const TEXT_EXTS = new Set([
  'txt', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env',
  'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'sh', 'bash', 'zsh', 'rb', 'php',
  'java', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'sql', 'gitignore', 'lock'
])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'])

function extOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index + 1).toLowerCase()
}

/** 是否可在应用内预览，以及预览类型 */
export function previewKind(path: string): PreviewKind {
  const ext = extOf(path)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (CSV_EXTS.has(ext)) return 'csv'
  if (TEXT_EXTS.has(ext)) return 'text'
  return null
}

export function isPreviewable(path: string): boolean {
  return previewKind(path) !== null
}

/** vault 相对路径 → myzsk-file:// URL（逐段编码） */
export function vaultFileUrl(relPath: string): string {
  const encoded = relPath
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `myzsk-file://vault/${encoded}`
}

/** 把 myzsk-file://vault/<encoded> 反向解析为 vault 相对路径 */
export function parseVaultFileUrl(url: string): string | null {
  if (!url.startsWith('myzsk-file://vault/')) return null
  try {
    const raw = url.slice('myzsk-file://vault/'.length)
    return raw
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}

/** 解析 Markdown 中的相对链接为目标 vault 相对路径；绝对 URL/锚点返回 null */
export function resolveRelativePath(href: string, notePath: string): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (ABSOLUTE_RE.test(trimmed)) return null
  return normalizePosix(`${dirOf(notePath)}/${trimmed}`)
}

/** POSIX 风格规范化（处理 . 与 ..） */
function normalizePosix(path: string): string {
  const parts = path.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}

function dirOf(notePath: string): string {
  const index = notePath.lastIndexOf('/')
  return index === -1 ? '' : notePath.slice(0, index)
}

/**
 * 把 href 解析为可加载 URL：
 * - 绝对 URL / data: / 锚点 → 原样返回
 * - 相对路径 → myzsk-file://vault/<相对 vault 的路径>（相对当前笔记目录）
 */
export function resolveAssetUrl(href: string, notePath: string): string {
  if (!href) return href
  const trimmed = href.trim()
  if (ABSOLUTE_RE.test(trimmed)) return trimmed
  return vaultFileUrl(normalizePosix(`${dirOf(notePath)}/${trimmed}`))
}

/** 把渲染后的 HTML 中相对路径的 <img src> 重写为可加载 URL */
export function rewriteImageSources(html: string, notePath: string): string {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]*)(")/gi, (_match, prefix: string, src: string, suffix: string) => {
    return `${prefix}${resolveAssetUrl(src, notePath)}${suffix}`
  })
}
