import { useRef, useState } from 'react'
import { Popover } from './Popover'
import { isSameDay, monthMatrix, toDateStamp } from '../utils/dates'

interface DatePickerProps {
  /** 'YYYY-MM-DD' */
  value: string
  onChange: (value: string) => void
}

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function DatePicker({ value, onChange }: DatePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const current = value ? new Date(`${value}T00:00:00`) : new Date()
  const [view, setView] = useState({ year: current.getFullYear(), month: current.getMonth() })
  const today = new Date()

  const openPopover = (): void => {
    const d = value ? new Date(`${value}T00:00:00`) : new Date()
    setView({ year: d.getFullYear(), month: d.getMonth() })
    setOpen(true)
  }

  const weeks = monthMatrix(view.year, view.month)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="picker-btn"
        onClick={() => (open ? setOpen(false) : openPopover())}
      >
        <span>{value ? value.replace(/-/g, ' / ') : '选择日期'}</span>
        <span className="picker-icon">📅</span>
      </button>
      {open && (
        <Popover anchor={anchorRef.current} onClose={() => setOpen(false)} width={264}>
          <div className="dp-header">
            <button
              type="button"
              className="dp-nav"
              onClick={() =>
                setView((v) => {
                  const m = v.month - 1
                  return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m }
                })
              }
            >
              ‹
            </button>
            <span className="dp-title">
              {view.year} 年 {view.month + 1} 月
            </span>
            <button
              type="button"
              className="dp-nav"
              onClick={() =>
                setView((v) => {
                  const m = v.month + 1
                  return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m }
                })
              }
            >
              ›
            </button>
          </div>
          <div className="dp-grid">
            {WEEK_LABELS.map((label) => (
              <div key={label} className="dp-weekday">
                {label}
              </div>
            ))}
            {weeks.flat().map((day) => {
              const stamp = toDateStamp(day)
              const selected = value === stamp
              return (
                <button
                  key={stamp}
                  type="button"
                  className={`dp-day ${selected ? 'selected' : ''} ${
                    isSameDay(day, today) ? 'today' : ''
                  } ${day.getMonth() !== view.month ? 'outside' : ''}`}
                  onClick={() => {
                    onChange(stamp)
                    setOpen(false)
                  }}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <div className="dp-footer">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                onChange(toDateStamp(new Date()))
                setOpen(false)
              }}
            >
              今天
            </button>
          </div>
        </Popover>
      )}
    </>
  )
}
