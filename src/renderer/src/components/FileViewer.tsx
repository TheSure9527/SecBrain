import { useEffect, useState } from 'react'
import { api } from '../api'
import {
  parseVaultFileUrl,
  previewKind,
  vaultFileUrl,
  type PreviewKind
} from '../../../shared/asset-url'

export interface OpenFilePayload {
  path: string
  name?: string
}

/** 触发内置查看器（全局事件总线） */
export function openFileViewer(path: string, name?: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenFilePayload>('myzsk:open-file', { detail: { path, name } })
  )
}

interface FileViewerProps {
  path: string
  name: string
  onClose: () => void
}

const KIND_LABEL: Record<Exclude<PreviewKind, null>, string> = {
  image: '图片',
  pdf: 'PDF',
  video: '视频',
  audio: '音频',
  text: '文本',
  csv: '表格'
}

/** 简单 CSV/TSV 解析（支持引号包裹，最多 300 行） */
function parseDelimited(text: string, delimiter: string, maxRows = 300): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length >= maxRows) break
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field || row.length > 0) rows.push([...row, field])
  return rows
}

export function FileViewer({ path, name, onClose }: FileViewerProps): React.JSX.Element {
  const kind = previewKind(path)
  const [scale, setScale] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [refCount, setRefCount] = useState<number | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const src = vaultFileUrl(path)

  // 文本 / CSV：读取文件内容（限制 2MB，避免卡死）
  useEffect(() => {
    if (kind !== 'text' && kind !== 'csv') return
    let cancelled = false
    setTextContent(null)
    setFailed(false)
    void fetch(src)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (cancelled) return
        setTextContent(text.slice(0, 2 * 1024 * 1024))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [kind, src])

  // 被多少篇笔记引用（附件也有反链）
  useEffect(() => {
    let cancelled = false
    void api.links
      .backlinks(path)
      .then((list) => {
        if (!cancelled) setRefCount(list.length)
      })
      .catch(() => {
        if (!cancelled) setRefCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (kind !== 'image') return
      if (event.key === '+' || event.key === '=') setScale((s) => Math.min(8, s * 1.25))
      if (event.key === '-') setScale((s) => Math.max(0.1, s / 1.25))
      if (event.key === '0') setScale(1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [kind, onClose])

  const openExternally = (): void => {
    void api.openExternal(path)
  }

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-header">
          <div className="viewer-title">
            <span className="viewer-name">{name}</span>
            <span className="viewer-kind">{kind ? KIND_LABEL[kind] : '文件'}</span>
            {refCount !== null && refCount > 0 && (
              <span className="viewer-refs">被 {refCount} 篇笔记引用</span>
            )}
          </div>
          <div className="viewer-actions">
            {kind === 'image' && (
              <>
                <button className="btn-ghost" title="缩小 (-)" onClick={() => setScale((s) => Math.max(0.1, s / 1.25))}>
                  −
                </button>
                <span className="viewer-scale">{Math.round(scale * 100)}%</span>
                <button className="btn-ghost" title="放大 (+)" onClick={() => setScale((s) => Math.min(8, s * 1.25))}>
                  ＋
                </button>
                <button className="btn-ghost" title="实际大小 (0)" onClick={() => setScale(1)}>
                  1:1
                </button>
              </>
            )}
            <button className="btn-ghost" onClick={openExternally} title="用系统应用打开">
              外部打开
            </button>
            <button className="btn-ghost" onClick={onClose} title="关闭 (Esc)">
              ✕
            </button>
          </div>
        </header>

        <div className="viewer-body">
          {kind === 'image' && (
            <div className="viewer-image-wrap">
              <img
                className="viewer-image"
                src={src}
                alt={name}
                style={{ transform: `scale(${scale})`, cursor: scale > 1 ? 'grab' : 'default' }}
                onLoad={() => setLoaded(true)}
                onError={() => {
                  setLoaded(true)
                  setFailed(true)
                }}
              />
              {!loaded && <div className="viewer-loading">加载中…</div>}
            </div>
          )}

          {kind === 'pdf' && (
            <iframe className="viewer-frame" src={src} title={name} onError={() => setFailed(true)} />
          )}

          {kind === 'video' && (
            <div className="viewer-media-wrap">
              <video className="viewer-video" src={src} controls autoPlay onError={() => setFailed(true)} />
            </div>
          )}

          {kind === 'audio' && (
            <div className="viewer-media-wrap">
              <audio className="viewer-audio" src={src} controls autoPlay onError={() => setFailed(true)} />
            </div>
          )}

          {kind === 'text' && textContent !== null && (
            <pre className="viewer-text">{formatText(path, textContent)}</pre>
          )}

          {kind === 'csv' && textContent !== null && (
            <div className="viewer-table-wrap">
              <CsvTable path={path} content={textContent} />
            </div>
          )}

          {failed && (
            <div className="viewer-fallback">
              <p>无法在应用内预览这个文件。</p>
              <button className="btn-primary" onClick={openExternally}>
                用系统应用打开
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** JSON 美化，其他原样返回 */
function formatText(path: string, content: string): string {
  if (/\.jsonc?$/i.test(path)) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return content
    }
  }
  return content
}

/** CSV/TSV 表格渲染（最多 300 行 × 20 列） */
function CsvTable({ path, content }: { path: string; content: string }): React.JSX.Element {
  const delimiter = /\.tsv$/i.test(path) ? '\t' : ','
  const rows = parseDelimited(content, delimiter).slice(0, 300)
  const header = rows[0] ?? []
  const body = rows.slice(1)
  return (
    <table className="viewer-table">
      {header.length > 0 && (
        <thead>
          <tr>
            {header.slice(0, 20).map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.slice(0, 20).map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 文件名（去掉目录） */
export function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** 从 myzsk-file URL 还原相对路径（预览区点击图片时用） */
export function relativePathFromUrl(url: string): string | null {
  return parseVaultFileUrl(url)
}
