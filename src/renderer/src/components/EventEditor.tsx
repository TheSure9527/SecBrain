import { useEffect, useMemo, useRef, useState } from 'react'
import {
  calendarApi,
  type CalendarEvent,
  type CalendarMeta,
  type ConflictCheckResult,
  type TimeSlot
} from '../api'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'
import {
  formatTime,
  localToUtcIso,
  stampToDate,
  utcIsoToLocal
} from '../utils/dates'
import { supportsEvents } from '../../../shared/calendar'

interface EventEditorProps {
  event: CalendarEvent | null
  defaultDate: string
  calendars: CalendarMeta[]
  onClose: () => void
  onSaved: () => void
}

const REMINDER_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '无提醒' },
  { value: 5, label: '提前 5 分钟' },
  { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' },
  { value: 1440, label: '提前 1 天' }
]

export function EventEditor({
  event,
  defaultDate,
  calendars,
  onClose,
  onSaved
}: EventEditorProps): React.JSX.Element {
  const isEdit = !!event
  const [title, setTitle] = useState(event?.title ?? '')
  /** 只把支持 VEVENT 的日历放进新建下拉；编辑时保留原日历以便迁移 */
  const eventCalendars = calendars.filter(
    (cal) => supportsEvents(cal) || cal.id === event?.calendarId
  )
  const [calendarId, setCalendarId] = useState(
    event?.calendarId ?? eventCalendars[0]?.id ?? calendars[0]?.id ?? 'local'
  )
  const [allDay, setAllDay] = useState(event?.allDay ?? false)
  const [location, setLocation] = useState(event?.location ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(
    event?.reminderMinutes ?? 15
  )

  const initial = useMemo(() => {
    if (event) {
      const startLocal = utcIsoToLocal(
        event.allDay ? `${event.startAt}T00:00:00` : event.startAt
      )
      const endLocal = event.allDay
        ? { date: event.endAt, time: '23:59' }
        : utcIsoToLocal(event.endAt)
      return { start: startLocal, end: endLocal }
    }
    const now = new Date()
    const hour = Math.min(now.getHours() + 1, 22)
    const start = `${String(hour).padStart(2, '0')}:00`
    return {
      start: { date: defaultDate, time: start },
      end: { date: defaultDate, time: `${String(hour + 1).padStart(2, '0')}:00` }
    }
  }, [event, defaultDate])

  const [startDate, setStartDate] = useState(initial.start.date)
  const [startTime, setStartTime] = useState(initial.start.time)
  const [endDate, setEndDate] = useState(initial.end.date)
  const [endTime, setEndTime] = useState(initial.end.time)

  const [conflict, setConflict] = useState<ConflictCheckResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setConflict(null)
  }, [startDate, startTime, endDate, endTime, allDay])

  // Mac 快捷键：Esc 关闭，⌘/Ctrl + ↵ 保存
  const saveRef = useRef<() => Promise<void>>(async () => {})
  saveRef.current = () => handleSave()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const startAt = allDay ? startDate : localToUtcIso(startDate, startTime)
  const endAt = allDay ? endDate : localToUtcIso(endDate, endTime)

  const timeInvalid =
    !allDay && new Date(endAt).getTime() <= new Date(startAt).getTime()

  const handleSave = async (ignoreConflict = false): Promise<void> => {
    setError(null)
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    if (timeInvalid) {
      setError('结束时间必须晚于开始时间')
      return
    }
    if (!ignoreConflict) {
      const result = await calendarApi.checkConflicts({
        startAt,
        endAt,
        allDay,
        excludeEventId: event?.id
      })
      if (result.conflicts.length > 0) {
        setConflict(result)
        return
      }
    }
    setSaving(true)
    try {
      if (isEdit && event) {
        await calendarApi.updateEvent({
          id: event.id,
          title: title.trim(),
          location,
          description,
          startAt,
          endAt,
          allDay,
          reminderMinutes
        })
      } else {
        await calendarApi.createEvent({
          calendarId,
          title: title.trim(),
          location,
          description,
          startAt,
          endAt,
          allDay,
          reminderMinutes
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const applySuggestion = (slot: TimeSlot): void => {
    const s = utcIsoToLocal(slot.startAt)
    const e = utcIsoToLocal(slot.endAt)
    setStartDate(s.date)
    setStartTime(s.time)
    setEndDate(e.date)
    setEndTime(e.time)
    setConflict(null)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-editor" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{isEdit ? '编辑事件' : '新建事件'}</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>标题</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="事件标题"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>日历</span>
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                disabled={isEdit}
              >
                {eventCalendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.source === 'local' ? '📱 ' : '☁️ '}
                    {cal.displayName}
                    {supportsEvents(cal) ? '' : '（提醒列表，不能建日程）'}
                  </option>
                ))}
              </select>
              {event &&
                (() => {
                  const current = calendars.find((cal) => cal.id === event.calendarId)
                  return current ? !supportsEvents(current) : false
                })() && (
                  <span className="field-hint">
                    该事件存在「提醒」列表里（不是日历），iCloud 两端都不会显示。建议删除后改选「个人」「工作」重建。
                  </span>
                )}
            </label>
            <label className="field field-inline">
              <span>全天</span>
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>开始日期</span>
              <DatePicker value={startDate} onChange={setStartDate} />
            </label>
            {!allDay && (
              <label className="field">
                <span>开始时间</span>
                <TimePicker value={startTime} onChange={setStartTime} />
              </label>
            )}
          </div>

          <div className="field-row">
            <label className="field">
              <span>结束日期</span>
              <DatePicker value={endDate} onChange={setEndDate} />
            </label>
            {!allDay && (
              <label className="field">
                <span>结束时间</span>
                <TimePicker value={endTime} onChange={setEndTime} />
              </label>
            )}
          </div>

          <label className="field">
            <span>地点</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="可选"
            />
          </label>

          <label className="field">
            <span>备注</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="可选"
            />
          </label>

          <label className="field">
            <span>提醒</span>
            <select
              value={reminderMinutes === null ? 'none' : String(reminderMinutes)}
              onChange={(e) =>
                setReminderMinutes(e.target.value === 'none' ? null : Number(e.target.value))
              }
            >
              {REMINDER_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value === null ? 'none' : String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {timeInvalid && <div className="form-error">结束时间必须晚于开始时间</div>}
          {error && <div className="form-error">{error}</div>}

          {conflict && (
            <div className="conflict-panel">
              <div className="conflict-title">
                与 {conflict.conflicts.length} 个事件时间冲突：
              </div>
              <ul className="conflict-list">
                {conflict.conflicts.map((c) => (
                  <li key={c.id}>
                    <span className="color-dot" style={{ background: c.color }} />
                    <span className="conflict-name">{c.title}</span>
                    <span className="conflict-time">
                      {c.allDay ? '全天' : `${formatTime(c.startAt)} - ${formatTime(c.endAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
              {conflict.suggestions.length > 0 && (
                <>
                  <div className="conflict-title">推荐时段：</div>
                  <div className="suggestion-list">
                    {conflict.suggestions.map((slot) => (
                      <button
                        key={slot.startAt}
                        className="btn-suggestion"
                        onClick={() => applySuggestion(slot)}
                      >
                        {stampToDate(slot.startAt).getMonth() + 1}/
                        {stampToDate(slot.startAt).getDate()}{' '}
                        {formatTime(slot.startAt)} - {formatTime(slot.endAt)}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="conflict-actions">
                <button className="btn-ghost" onClick={() => void handleSave(true)}>
                  仍要保存
                </button>
                <button className="btn-ghost" onClick={() => setConflict(null)}>
                  返回修改
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          {isEdit && event && (
            <button
              className="btn-danger"
              onClick={() => {
                void calendarApi.deleteEvent(event.id).then(() => {
                  onSaved()
                  onClose()
                })
              }}
            >
              删除
            </button>
          )}
          <div className="footer-spacer" />
          <span className="shortcut-hint">⌘↵ 保存 · Esc 取消</span>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}
