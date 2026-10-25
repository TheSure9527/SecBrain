import { useState } from 'react'
import { api, type NoteDoc } from '../api'

interface PropertiesEditorProps {
  doc: NoteDoc
  onClose: () => void
  onSaved: (doc: NoteDoc) => void
}

interface Row {
  key: string
  value: string
}

/** front-matter 属性编辑器：键值增删改，数字/布尔/数组自动识别 */
export function PropertiesEditor({ doc, onClose, onSaved }: PropertiesEditorProps): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>(
    Object.entries(doc.props).map(([key, value]) => ({ key, value }))
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const update = (index: number, patch: Partial<Row>): void => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const save = async (): Promise<void> => {
    setError(null)
    const props: Record<string, string> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      if (props[key] !== undefined) {
        setError(`属性名重复：${key}`)
        return
      }
      props[key] = row.value
    }
    setSaving(true)
    try {
      const next = await api.updateProps({ path: doc.path, props })
      onSaved(next)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal props-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>笔记属性</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <p className="settings-hint">
            自定义 front-matter 属性，可用于 Dataview 查询。数字、true/false、[a, b] 会被识别为对应类型。
          </p>
          {rows.length === 0 && <div className="links-empty">还没有自定义属性</div>}
          {rows.map((row, index) => (
            <div key={index} className="prop-row">
              <input
                className="prop-key"
                value={row.key}
                onChange={(e) => update(index, { key: e.target.value })}
                placeholder="属性名"
              />
              <input
                className="prop-value"
                value={row.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder="值"
              />
              <button
                className="btn-ghost"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}>
            ＋ 添加属性
          </button>
          {error && <div className="form-error">{error}</div>}
        </div>

        <footer className="modal-footer">
          <div className="footer-spacer" />
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}
