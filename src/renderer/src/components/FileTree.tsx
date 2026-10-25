import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type TrashEntry } from '../api'
import type { TreeNode } from '../api'
import { isPreviewable } from '../../../shared/asset-url'
import { openFileViewer } from './FileViewer'

interface FileTreeProps {
  activePath: string | null
  onOpenNote: (path: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  /** null = 空白区域（根目录） */
  node: TreeNode | null
}

const EXPANDED_KEY = 'myzsk.fileTree.expanded'

/** 按扩展名给文件配图标 */
function fileIcon(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (['md', 'markdown'].includes(ext)) return '📄'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return '🖼'
  if (ext === 'pdf') return '📕'
  if (['mp3', 'wav', 'm4a', 'flac', 'aac'].includes(ext)) return '🎵'
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return '🎬'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦'
  if (['doc', 'docx', 'rtf', 'pages'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return '📊'
  if (['ppt', 'pptx', 'key'].includes(ext)) return '📈'
  if (['json', 'yaml', 'yml', 'toml', 'js', 'ts', 'py', 'sh'].includes(ext)) return '🧩'
  return '📎'
}

function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveExpanded(paths: Set<string>): void {
  localStorage.setItem(EXPANDED_KEY, JSON.stringify([...paths]))
}

export function FileTree({ activePath, onOpenNote }: FileTreeProps): React.JSX.Element {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<TrashEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setTree(await api.getTree())
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = api.onVaultChanged((change) => {
      if (change.type === 'tree' || change.type === 'upsert' || change.type === 'delete') {
        void refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  useEffect(() => {
    saveExpanded(expanded)
  }, [expanded])

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const dirOf = (path: string): string => path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''

  const startRename = (node: TreeNode): void => {
    setRenamingPath(node.path)
    setRenameValue(node.kind === 'file' ? node.name.replace(/\.md$/i, '') : node.name)
    setMenu(null)
  }

  const commitRename = async (): Promise<void> => {
    const path = renamingPath
    const value = renameValue.trim()
    setRenamingPath(null)
    if (!path || !value) return
    try {
      const newPath = await api.renameEntry({ path, newName: value })
      if (activePath === path) onOpenNote(newPath)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateNote = async (dir: string): Promise<void> => {
    setMenu(null)
    try {
      const doc = await api.createInDir({ dir })
      await refresh()
      onOpenNote(doc.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateDir = async (dir: string): Promise<void> => {
    setMenu(null)
    try {
      await api.createDir({ dir, name: '新建文件夹' })
      if (dir) setExpanded((prev) => new Set(prev).add(dir))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (node: TreeNode): Promise<void> => {
    setMenu(null)
    try {
      await api.deleteEntry(node.path)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDrop = async (targetDir: string, sourcePath: string): Promise<void> => {
    setDragOverPath(null)
    if (!sourcePath || dirOf(sourcePath) === targetDir) return
    if (targetDir === sourcePath || targetDir.startsWith(`${sourcePath}/`)) return
    try {
      const newPath = await api.moveEntry({ path: sourcePath, targetDir })
      if (activePath === sourcePath) onOpenNote(newPath)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openTrash = async (): Promise<void> => {
    setTrash(await api.listTrash())
    setTrashOpen(true)
  }

  const renderNode = (node: TreeNode, depth: number): React.JSX.Element => {
    const isActive = node.path === activePath
    const isExpanded = expanded.has(node.path)
    const isRenaming = renamingPath === node.path

    if (node.kind === 'folder') {
      return (
        <div key={node.path}>
          <div
            className={`tree-row folder ${dragOverPath === node.path ? 'drop-target' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => toggleExpand(node.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, node })
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOverPath(node.path)
            }}
            onDragLeave={() => setDragOverPath(null)}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void handleDrop(node.path, e.dataTransfer.getData('text/myzk-path'))
            }}
          >
            <span className={`tree-arrow ${isExpanded ? 'open' : ''}`}>›</span>
            {isRenaming ? (
              <input
                className="tree-rename"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  if (e.key === 'Escape') setRenamingPath(null)
                }}
              />
            ) : (
              <span className="tree-name">📁 {node.name}</span>
            )}
            <span className="tree-actions">
              <button
                title="新建笔记"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleCreateNote(node.path)
                }}
              >
                ＋
              </button>
            </span>
          </div>
          {isExpanded &&
            node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    return (
      <div
        key={node.path}
        className={`tree-row file ${isActive ? 'active' : ''} ${
          dragOverPath === node.path ? 'drop-target' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/myzk-path', node.path)
          e.stopPropagation()
        }}
        onClick={() => {
          if (isMarkdown(node.name)) {
            onOpenNote(node.path)
          } else if (isPreviewable(node.path)) {
            openFileViewer(node.path, node.name)
          } else {
            void api.openExternal(node.path).catch((err) => {
              setError(err instanceof Error ? err.message : String(err))
            })
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, node })
        }}
        title={isMarkdown(node.name) ? undefined : '用系统默认应用打开'}
      >
        {isRenaming ? (
          <input
            className="tree-rename"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              if (e.key === 'Escape') setRenamingPath(null)
            }}
          />
        ) : (
          <span className="tree-name">
            <span className="tree-file-icon">{fileIcon(node.name)}</span>
            {isMarkdown(node.name) ? node.name.replace(/\.md$/i, '') : node.name}
          </span>
        )}
      </div>
    )
  }

  const menuNode = menu?.node ?? null
  const menuDir = menuNode
    ? menuNode.kind === 'folder'
      ? menuNode.path
      : dirOf(menuNode.path)
    : ''

  return (
    <div
      className="file-tree"
      ref={rootRef}
      onContextMenu={(e) => {
        // 空白区域 = 根目录菜单
        if (e.target === e.currentTarget) {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }
      }}
      onDragOver={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          setDragOverPath('')
        }
      }}
      onDragLeave={() => setDragOverPath(null)}
      onDrop={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          void handleDrop('', e.dataTransfer.getData('text/myzk-path'))
        }
      }}
    >
      <div className="file-tree-toolbar">
        <button title="在根目录新建笔记" onClick={() => void handleCreateNote('')}>
          ＋ 笔记
        </button>
        <button title="新建文件夹" onClick={() => void handleCreateDir('')}>
          📁
        </button>
        <button title="回收站" onClick={() => void openTrash()}>
          🗑
        </button>
        <button
          title="日记（热图）"
          onClick={() => window.dispatchEvent(new CustomEvent('myzsk:open-daily-panel'))}
        >
          📔
        </button>
      </div>

      <div className="file-tree-body">
        {tree.length === 0 && <div className="tree-empty">知识库为空</div>}
        {tree.map((node) => renderNode(node, 0))}
      </div>

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuNode?.kind === 'folder' && (
            <>
              <div className="context-menu-item" onClick={() => void handleCreateNote(menuNode.path)}>
                新建笔记
              </div>
              <div className="context-menu-item" onClick={() => void handleCreateDir(menuNode.path)}>
                新建文件夹
              </div>
              <div className="context-menu-divider" />
            </>
          )}
          {menuNode?.kind === 'file' && (
            <>
              {isPreviewable(menuNode.path) && (
                <div
                  className="context-menu-item"
                  onClick={() => {
                    setMenu(null)
                    openFileViewer(menuNode.path, menuNode.name)
                  }}
                >
                  应用内预览
                </div>
              )}
              <div
                className="context-menu-item"
                onClick={() => {
                  setMenu(null)
                  void api.openExternal(menuNode.path)
                }}
              >
                用系统应用打开
              </div>
              <div className="context-menu-divider" />
            </>
          )}
          {menuNode && (
            <>
              <div className="context-menu-item" onClick={() => startRename(menuNode)}>
                重命名
              </div>
              <div
                className="context-menu-item danger"
                onClick={() => void handleDelete(menuNode)}
              >
                删除（移入回收站）
              </div>
              <div className="context-menu-divider" />
            </>
          )}
          <div className="context-menu-item" onClick={() => void handleCreateNote(menuDir)}>
            在此新建笔记
          </div>
          <div className="context-menu-item" onClick={() => void openTrash()}>
            打开回收站
          </div>
        </div>
      )}

      {trashOpen && (
        <TrashModal
          entries={trash}
          onClose={() => setTrashOpen(false)}
          onChanged={() => {
            void refresh()
            void openTrash()
          }}
        />
      )}

      {error && (
        <div className="tree-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}

function TrashModal({
  entries,
  onClose,
  onChanged
}: {
  entries: TrashEntry[]
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const handleEmpty = async (): Promise<void> => {
    await api.emptyTrash()
    onChanged()
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal trash-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>回收站</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          {entries.length === 0 && <div className="trash-empty">回收站是空的</div>}
          {entries.map((entry) => (
            <div key={entry.name} className="trash-row">
              <div className="trash-info">
                <div className="trash-name">{entry.originalPath}</div>
                <div className="trash-time">
                  删除于 {new Date(entry.deletedAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <button
                className="btn-ghost"
                onClick={() => {
                  void api.restoreEntry(entry.name).then(onChanged)
                }}
              >
                恢复
              </button>
            </div>
          ))}
        </div>
        <footer className="modal-footer">
          <div className="footer-spacer" />
          {entries.length > 0 && (
            <button className="btn-danger" onClick={() => void handleEmpty()}>
              清空回收站
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
