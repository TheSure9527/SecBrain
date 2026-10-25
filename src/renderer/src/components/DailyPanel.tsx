import { useEffect, useMemo, useState } from 'react'
import { api, dailyApi, type DailyStat, type NoteMeta } from '../api'

interface DailyPanelProps {
  onOpenNote: (path: string) => void
  onClose: () => void
}

const WEEK_LABELS = ['一', '', '三', '', '五', '', '日']

/** 按周对齐（周一为起点）的 0/1/2/3 级强度 */
function levelOf(stat: DailyStat | undefined): number {
  if (!stat) return 0
  const total = stat.notes + stat.tasks
  if (total === 0) return 0
  if (total <= 1) return 1
  if (total <= 3) return 2
  return 3
}

export function DailyPanel({ onOpenNote, onClose }: DailyPanelProps): React.JSX.Element {
  const [stats, setStats] = useState<DailyStat[]>([])
  const [dailyNotes, setDailyNotes] = useState<NoteMeta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const [data, notes, settings] = await Promise.all([
        dailyApi.stats(84),
        api.listNotes(),
        api.getAppSettings()
      ])
      setStats(data)
      // 目录以设置为准（用户可能把日记目录改成 journal/ 之类）
      const dir = (settings.dailyDir || '日记').replace(/\/+$/, '')
      setDailyNotes(
        notes
          .filter((note) => note.path.startsWith(`${dir}/`) && !note.path.slice(dir.length + 1).includes('/'))
          .sort((a, b) => b.path.localeCompare(a.path))
          .slice(0, 8)
      )
      setLoading(false)
    })()
  }, [])

  // 按周分列（周一 → 周日）
  const weeks = useMemo(() => {
    const sorted = [...stats].sort((a, b) => a.date.localeCompare(b.date))
    const columns: Array<Array<DailyStat | null>> = []
    let current: Array<DailyStat | null> = new Array(7).fill(null)
    for (const stat of sorted) {
      const day = new Date(`${stat.date}T00:00:00`).getDay() // 0=周日
      const index = day === 0 ? 6 : day - 1
      if (index === 0 && current.some((cell) => cell !== null)) {
        columns.push(current)
        current = new Array(7).fill(null)
      }
      current[index] = stat
    }
    if (current.some((cell) => cell !== null)) columns.push(current)
    return columns
  }, [stats])

  const openToday = async (): Promise<void> => {
    const { path } = await dailyApi.open()
    onOpenNote(path)
    onClose()
  }

  const openDay = async (date: string): Promise<void> => {
    const { path } = await dailyApi.open(date)
    onOpenNote(path)
    onClose()
  }

  // 快捷键：Esc 关闭 · T/Enter 今天 · ←/→ 前一天/后一天
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key
      if (key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (key === 't' || key === 'T' || key === 'Enter') {
        event.preventDefault()
        void openToday()
        return
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault()
        const target = new Date()
        target.setDate(target.getDate() + (key === 'ArrowLeft' ? -1 : 1))
        const stamp = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
        void openDay(stamp)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const today = new Date()
  const todayStamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal daily-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>日记</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="daily-actions">
            <button className="btn-primary" onClick={() => void openToday()}>
              打开今天（{todayStamp}）
            </button>
            <span className="daily-shortcuts">
              <kbd>T</kbd>/<kbd>↵</kbd> 今天 · <kbd>←</kbd><kbd>→</kbd> 前后一天 ·{' '}
              <kbd>Esc</kbd> 关闭
            </span>
          </div>

          <div className="daily-heatmap-wrap">
            <div className="daily-heatmap">
              <div className="heatmap-weekdays">
                {WEEK_LABELS.map((label, index) => (
                  <div key={index} className="heatmap-weekday">
                    {label}
                  </div>
                ))}
              </div>
              <div className="heatmap-weeks">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="heatmap-week">
                    {week.map((cell, dayIndex) => (
                      <button
                        key={dayIndex}
                        className={`heatmap-cell level-${
                          cell ? levelOf(cell) : 0
                        } ${cell?.date === todayStamp ? 'today' : ''}`}
                        title={
                          cell
                            ? `${cell.date}：${cell.notes} 篇笔记 · ${cell.tasks} 个任务完成`
                            : ''
                        }
                        disabled={!cell}
                        onClick={() => cell && void openDay(cell.date)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="heatmap-legend">
              <span>少</span>
              {[0, 1, 2, 3].map((level) => (
                <i key={level} className={`heatmap-cell level-${level}`} />
              ))}
              <span>多</span>
            </div>
          </div>

          <div className="daily-recent">
            <div className="daily-recent-title">最近的日记</div>
            {loading && <div className="links-empty">加载中…</div>}
            {!loading && dailyNotes.length === 0 && (
              <div className="links-empty">还没有日记，点上面的按钮开始今天的记录</div>
            )}
            <ul className="daily-list">
              {dailyNotes.map((note) => (
                <li
                  key={note.path}
                  className="daily-list-item"
                  onClick={() => {
                    onOpenNote(note.path)
                    onClose()
                  }}
                >
                  <span>{note.title}</span>
                  <span className="daily-list-date">{note.path.split('/').pop()?.replace(/\.md$/, '')}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="modal-footer">
          <span className="settings-hint" style={{ margin: 0 }}>
            模板与目录可在「设置 → 日记」中配置
          </span>
          <div className="footer-spacer" />
          <button className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
