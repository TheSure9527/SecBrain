import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  calendarApi,
  type CalendarAccountStatus,
  type CalendarEvent,
  type CalendarMeta
} from '../api'
import { EventEditor } from '../components/EventEditor'
import {
  formatTime,
  isSameDay,
  monthMatrix,
  stampToDate,
  toDateStamp,
  weekDates
} from '../utils/dates'

type ViewMode = 'month' | 'week'

export function CalendarView(): React.JSX.Element {
  const [mode, setMode] = useState<ViewMode>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [calendars, setCalendars] = useState<CalendarMeta[]>([])
  const [status, setStatus] = useState<CalendarAccountStatus | null>(null)
  const [editing, setEditing] = useState<{ event: CalendarEvent | null } | null>(null)

  const range = useMemo(() => {
    if (mode === 'month') {
      const weeks = monthMatrix(cursor.getFullYear(), cursor.getMonth())
      const start = weeks[0]![0]!
      const end = weeks[5]![6]!
      return { start: toDateStamp(start), end: toDateStamp(end) }
    }
    const days = weekDates(cursor)
    return { start: toDateStamp(days[0]!), end: toDateStamp(days[6]!) }
  }, [mode, cursor])

  const refresh = useCallback(async () => {
    const [loadedEvents, loadedCalendars, accountStatus] = await Promise.all([
      calendarApi.getEvents(range),
      calendarApi.listCalendars(),
      calendarApi.getAccountStatus()
    ])
    setEvents(loadedEvents)
    setCalendars(loadedCalendars)
    setStatus(accountStatus)
  }, [range])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const shift = (direction: -1 | 1): void => {
    const next = new Date(cursor)
    if (mode === 'month') next.setMonth(next.getMonth() + direction)
    else next.setDate(next.getDate() + 7 * direction)
    setCursor(next)
  }

  const goToday = (): void => {
    const now = new Date()
    setCursor(now)
    setSelected(now)
  }

  // Mac 键盘操作：←/→ 翻页，T 回到今天，N/⌘N 新建事件（编辑器打开时由其自身处理）
  useEffect(() => {
    if (editing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.metaKey || event.ctrlKey) {
        if (event.key === 'n') {
          event.preventDefault()
          openCreate()
        }
        return
      }
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          shift(-1)
          break
        case 'ArrowRight':
          event.preventDefault()
          shift(1)
          break
        case 't':
        case 'T':
          event.preventDefault()
          goToday()
          break
        case 'n':
        case 'N':
          event.preventDefault()
          openCreate()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const selectedStamp = toDateStamp(selected)
  const selectedEvents = useMemo(
    () =>
      events
        .filter((e) => {
          const start = stampToDate(e.startAt)
          const end = stampToDate(e.endAt)
          return (
            isSameDay(start, selected) ||
            isSameDay(end, selected) ||
            (start <= selected && end >= selected)
          )
        })
        .sort((a, b) => stampToDate(a.startAt).getTime() - stampToDate(b.startAt).getTime()),
    [events, selected]
  )

  const headerTitle =
    mode === 'month'
      ? `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`
      : `${weekDates(cursor)[0]!.getMonth() + 1}/${weekDates(cursor)[0]!.getDate()} - ${weekDates(cursor)[6]!.getMonth() + 1}/${weekDates(cursor)[6]!.getDate()}`

  const openCreate = (date?: Date): void => {
    setSelected(date ?? selected)
    setEditing({ event: null })
  }

  return (
    <div className="calendar-view">
      <header className="calendar-header">
        <div className="calendar-nav">
          <button className="btn-ghost" onClick={() => shift(-1)}>
            ‹
          </button>
          <button className="btn-ghost" onClick={goToday}>
            今天
          </button>
          <button className="btn-ghost" onClick={() => shift(1)}>
            ›
          </button>
          <h1 className="calendar-title">{headerTitle}</h1>
        </div>
        <div className="calendar-actions">
          {status && (
            <span className={`sync-badge ${status.status}`} title={status.error ?? ''}>
              {status.status === 'connected'
                ? `已同步 · ${status.calendarCount} 个日历`
                : status.status === 'error'
                  ? `同步失败`
                  : '未连接'}
            </span>
          )}
          <div className="view-toggle">
            <button
              className={mode === 'month' ? 'active' : ''}
              onClick={() => setMode('month')}
            >
              月
            </button>
            <button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>
              周
            </button>
          </div>
          <span className="kbd-hint" title="键盘快捷键">
            ← → 翻页 · T 今天 · N 新建
          </span>
          <button className="btn-primary" onClick={() => openCreate()}>
            ＋ 新建事件
          </button>
        </div>
      </header>

      <div className="calendar-body">
        <div className="calendar-main">
          {mode === 'month' ? (
            <MonthGrid
              cursor={cursor}
              events={events}
              selected={selected}
              onSelect={(d) => setSelected(d)}
              onOpenEvent={(e) => setEditing({ event: e })}
              onCreateAt={(d) => openCreate(d)}
            />
          ) : (
            <WeekGrid
              cursor={cursor}
              events={events}
              selected={selected}
              onSelect={(d) => setSelected(d)}
              onOpenEvent={(e) => setEditing({ event: e })}
              onCreateAt={(d) => openCreate(d)}
            />
          )}
        </div>

        <aside className="day-agenda">
          <div className="agenda-header">
            <h2>
              {selected.getMonth() + 1} 月 {selected.getDate()} 日
              <span className="agenda-weekday">
                {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][selected.getDay()]}
              </span>
            </h2>
            <button className="btn-ghost" onClick={() => openCreate(selected)}>
              ＋
            </button>
          </div>
          <ul className="agenda-list">
            {selectedEvents.map((event) => (
              <li
                key={event.id}
                className="agenda-item"
                onClick={() => setEditing({ event })}
              >
                <span className="color-dot" style={{ background: event.color }} />
                <div className="agenda-item-body">
                  <div className="agenda-item-title">{event.title}</div>
                  <div className="agenda-item-meta">
                    {event.allDay
                      ? '全天'
                      : `${formatTime(event.startAt)} - ${formatTime(event.endAt)}`}
                    {event.location ? ` · ${event.location}` : ''}
                    {event.rrule ? ' · 重复' : ''}
                  </div>
                </div>
              </li>
            ))}
            {selectedEvents.length === 0 && (
              <li className="agenda-empty">这一天还没有安排</li>
            )}
          </ul>
        </aside>
      </div>

      {editing && (
        <EventEditor
          event={editing.event}
          defaultDate={selectedStamp}
          calendars={calendars}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  )
}

interface GridProps {
  cursor: Date
  events: CalendarEvent[]
  selected: Date
  onSelect: (date: Date) => void
  onOpenEvent: (event: CalendarEvent) => void
  onCreateAt: (date: Date) => void
}

function MonthGrid({
  cursor,
  events,
  selected,
  onSelect,
  onOpenEvent,
  onCreateAt
}: GridProps): React.JSX.Element {
  const weeks = monthMatrix(cursor.getFullYear(), cursor.getMonth())
  const today = new Date()

  return (
    <div className="month-grid">
      {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
        <div key={label} className="month-weekday">
          {label}
        </div>
      ))}
      {weeks.flat().map((day) => {
        const stamp = toDateStamp(day)
        const dayEvents = events.filter((e) => {
          const s = toDateStamp(stampToDate(e.startAt))
          const en = toDateStamp(stampToDate(e.endAt))
          return s <= stamp && en >= stamp
        })
        return (
          <div
            key={stamp}
            className={`month-cell ${isSameDay(day, today) ? 'today' : ''} ${
              isSameDay(day, selected) ? 'selected' : ''
            } ${day.getMonth() !== cursor.getMonth() ? 'outside' : ''}`}
            onClick={() => onSelect(day)}
            onDoubleClick={() => onCreateAt(day)}
          >
            <div className="month-cell-date">{day.getDate()}</div>
            <div className="month-cell-events">
              {dayEvents.slice(0, 3).map((event) => (
                <div
                  key={event.id}
                  className="event-chip"
                  style={{ borderLeftColor: event.color }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenEvent(event)
                  }}
                  title={`${event.title}${event.allDay ? '（全天）' : ` ${formatTime(event.startAt)}`}`}
                >
                  {!event.allDay && (
                    <span className="chip-time">{formatTime(event.startAt)}</span>
                  )}
                  <span className="chip-title">{event.title}</span>
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div className="month-cell-more">+{dayEvents.length - 3} 更多</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekGrid({
  cursor,
  events,
  selected,
  onSelect,
  onOpenEvent,
  onCreateAt
}: GridProps): React.JSX.Element {
  const days = weekDates(cursor)
  const today = new Date()
  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className="week-grid">
      <div className="week-header">
        <div className="week-gutter" />
        {days.map((day) => (
          <div
            key={toDateStamp(day)}
            className={`week-day-header ${isSameDay(day, today) ? 'today' : ''} ${
              isSameDay(day, selected) ? 'selected' : ''
            }`}
            onClick={() => onSelect(day)}
          >
            <span className="week-day-name">
              {['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}
            </span>
            <span className="week-day-num">{day.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="week-body">
        <div className="week-gutter">
          {hours.map((hour) => (
            <div key={hour} className="week-hour-label">
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((day) => {
          const dayStart = new Date(day)
          dayStart.setHours(0, 0, 0, 0)
          const dayEnd = new Date(day)
          dayEnd.setHours(23, 59, 59, 999)
          const dayEvents = events.filter((e) => {
            if (e.allDay) return isSameDay(stampToDate(e.startAt), day)
            const start = stampToDate(e.startAt)
            const end = stampToDate(e.endAt)
            return start < dayEnd && end > dayStart
          })
          return (
            <div
              key={toDateStamp(day)}
              className={`week-day-column ${isSameDay(day, today) ? 'today' : ''} ${
                isSameDay(day, selected) ? 'selected' : ''
              }`}
              onClick={() => onSelect(day)}
              onDoubleClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = (e.clientY - rect.top) / rect.height
                const hour = Math.floor(ratio * 24)
                const target = new Date(day)
                target.setHours(hour, 0, 0, 0)
                onSelect(target)
                onCreateAt(target)
              }}
            >
              {dayEvents.map((event) => {
                if (event.allDay) {
                  return (
                    <div
                      key={event.id}
                      className="week-allday"
                      style={{ background: event.color }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenEvent(event)
                      }}
                    >
                      {event.title}
                    </div>
                  )
                }
                const start = stampToDate(event.startAt)
                const end = stampToDate(event.endAt)
                const startMinutes = start.getHours() * 60 + start.getMinutes()
                const durationMinutes = Math.max(
                  30,
                  (end.getTime() - start.getTime()) / 60000
                )
                const top = (startMinutes / 1440) * 100
                const height = (durationMinutes / 1440) * 100
                return (
                  <div
                    key={event.id}
                    className="week-event"
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      borderLeftColor: event.color
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenEvent(event)
                    }}
                  >
                    <div className="week-event-title">{event.title}</div>
                    <div className="week-event-time">
                      {formatTime(event.startAt)} - {formatTime(event.endAt)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
