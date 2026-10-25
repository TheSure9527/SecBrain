import { useMemo, useRef, useState } from 'react'
import { Popover } from './Popover'

interface TimePickerProps {
  /** 'HH:mm' */
  value: string
  onChange: (value: string) => void
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 分钟选项：5 分钟步进，同时兼容已有的非整 5 分钟值 */
function minuteOptions(currentMinute: number): number[] {
  const list = Array.from({ length: 12 }, (_, i) => i * 5)
  if (!list.includes(currentMinute)) {
    list.push(currentMinute)
    list.sort((a, b) => a - b)
  }
  return list
}

export function TimePicker({ value, onChange }: TimePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const [hourText, minuteText] = value.split(':')
  const currentHour = Number(hourText)
  const currentMinute = Number(minuteText)

  const minutes = useMemo(() => minuteOptions(currentMinute), [currentMinute])
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), [])

  const commit = (hour: number, minute: number): void => {
    onChange(`${pad(hour)}:${pad(minute)}`)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="picker-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value || '--:--'}</span>
        <span className="picker-icon">🕐</span>
      </button>
      {open && (
        <Popover anchor={anchorRef.current} onClose={() => setOpen(false)} width={200}>
          <div className="tp-cols">
            <div className="tp-col" role="listbox" aria-label="小时">
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className={`tp-item ${hour === currentHour ? 'selected' : ''}`}
                  onClick={() => commit(hour, currentMinute)}
                >
                  {pad(hour)}
                </button>
              ))}
            </div>
            <div className="tp-col" role="listbox" aria-label="分钟">
              {minutes.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className={`tp-item ${minute === currentMinute ? 'selected' : ''}`}
                  onClick={() => {
                    commit(currentHour, minute)
                    setOpen(false)
                  }}
                >
                  {pad(minute)}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}
