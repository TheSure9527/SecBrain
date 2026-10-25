import ICAL from 'ical.js'

export interface ParsedVEvent {
  uid: string
  title: string
  description: string
  location: string
  /** ISO UTC（定时）或 'YYYY-MM-DD'（全天） */
  startAt: string
  endAt: string
  allDay: boolean
  rrule: string | null
  reminderMinutes: number | null
}

import { isAllDayStamp, randomId } from '../domain'

export { isAllDayStamp }

function timeToStamp(time: ICAL.Time): string {
  if (time.isDate) {
    return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
  }
  const utc = time.toJSDate()
  return utc.toISOString()
}

function stampToTime(stamp: string): ICAL.Time {
  if (isAllDayStamp(stamp)) {
    return ICAL.Time.fromDateString(stamp)
  }
  // fromJSDate(js, true) 直接产出带 Z 后缀的 UTC 时间；再设 zone 反而会丢 Z
  return ICAL.Time.fromJSDate(new Date(stamp), true)
}

/** TRIGGER 相对时长（如 -PT15M / PT1H）转分钟数（取正值＝提前量）；非相对触发器返回 null */
function triggerToMinutes(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const dur = value as ICAL.Duration
  if (typeof dur.toSeconds !== 'function') return null
  return Math.abs(Math.round(dur.toSeconds() / 60))
}

/** 解析 iCalendar 文本中的全部 VEVENT */
export function parseICalEvents(icalString: string): ParsedVEvent[] {
  let comp: ICAL.Component
  try {
    comp = new ICAL.Component(ICAL.parse(icalString))
  } catch {
    return []
  }
  if (comp.name !== 'vcalendar') return []

  const out: ParsedVEvent[] = []
  for (const veventComp of comp.getAllSubcomponents('vevent')) {
    try {
      const event = new ICAL.Event(veventComp)
      const start = event.startDate
      const end = event.endDate
      if (!start || !end) continue

      const rruleValue = veventComp.getFirstPropertyValue('rrule')
      const rrule =
        rruleValue && typeof (rruleValue as ICAL.Recur).toString === 'function'
          ? (rruleValue as ICAL.Recur).toString()
          : null

      let reminderMinutes: number | null = null
      for (const alarm of veventComp.getAllSubcomponents('valarm')) {
        const action = alarm.getFirstPropertyValue('action')
        if (action !== 'DISPLAY') continue
        const minutes = triggerToMinutes(alarm.getFirstPropertyValue('trigger'))
        if (minutes !== null) {
          reminderMinutes = minutes
          break
        }
      }

      out.push({
        uid: event.uid || cryptoRandomId(),
        title: event.summary || '未命名事件',
        description: event.description || '',
        location: event.location || '',
        startAt: timeToStamp(start),
        endAt: timeToStamp(end),
        allDay: !!start.isDate,
        rrule,
        reminderMinutes
      })
    } catch {
      // 跳过无法解析的单个事件
    }
  }
  return out
}

export interface BuildVEventInput {
  uid: string
  title: string
  description?: string
  location?: string
  startAt: string
  endAt: string
  allDay: boolean
  rrule?: string | null
  reminderMinutes?: number | null
}

function cryptoRandomId(): string {
  return randomId()
}

/** 构造单个 VEVENT 组件 */
function createVEventComponent(input: BuildVEventInput): ICAL.Component {
  const vevent = new ICAL.Component('vevent')
  vevent.updatePropertyWithValue('uid', input.uid)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now())

  const start = stampToTime(input.startAt)
  const end = stampToTime(input.endAt)
  vevent.addPropertyWithValue('dtstart', start)
  vevent.addPropertyWithValue('dtend', end)
  vevent.updatePropertyWithValue('summary', input.title || '未命名事件')
  if (input.description) vevent.updatePropertyWithValue('description', input.description)
  if (input.location) vevent.updatePropertyWithValue('location', input.location)
  if (input.rrule) {
    vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(input.rrule))
  }
  if (input.reminderMinutes !== null && input.reminderMinutes !== undefined) {
    const alarm = new ICAL.Component('valarm')
    alarm.updatePropertyWithValue('action', 'DISPLAY')
    alarm.updatePropertyWithValue('description', input.title || '提醒')
    alarm.updatePropertyWithValue(
      'trigger',
      ICAL.Duration.fromString(`-PT${Math.max(1, Math.round(input.reminderMinutes))}M`)
    )
    vevent.addSubcomponent(alarm)
  }
  return vevent
}

function createVCalendar(): ICAL.Component {
  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('prodid', '-//myzsk//CN')
  cal.updatePropertyWithValue('version', '2.0')
  cal.updatePropertyWithValue('calscale', 'GREGORIAN')
  return cal
}

/** 构造完整 VCALENDAR 字符串（用于 CalDAV 创建/更新） */
export function buildVEventString(input: BuildVEventInput): string {
  const cal = createVCalendar()
  cal.addSubcomponent(createVEventComponent(input))
  return cal.toString()
}

/** 批量导出：一个 VCALENDAR 里包含全部事件与（可选）提醒 */
export function buildVCalendar(input: {
  events: BuildVEventInput[]
  todos?: Array<{
    uid: string
    title: string
    notes?: string
    dueAt?: string | null
    completed: boolean
    completedAt?: string | null
    priority?: number
  }>
}): string {
  const cal = createVCalendar()
  for (const event of input.events) cal.addSubcomponent(createVEventComponent(event))
  for (const todo of input.todos ?? []) {
    const parsed = parseVTodos(
      buildVTodoString({
        uid: todo.uid,
        title: todo.title,
        notes: todo.notes,
        dueAt: todo.dueAt ?? null,
        priority: todo.priority ?? 0,
        completed: todo.completed,
        completedAt: todo.completedAt ?? null
      })
    )
    if (parsed.length > 0) {
      // 复用解析结果构造 VTODO，保证与单条创建时的字段一致
      const component = new ICAL.Component('vtodo')
      component.updatePropertyWithValue('uid', todo.uid)
      component.updatePropertyWithValue('dtstamp', ICAL.Time.now())
      component.updatePropertyWithValue('summary', todo.title)
      if (todo.notes) component.updatePropertyWithValue('description', todo.notes)
      if (todo.dueAt) component.addPropertyWithValue('due', stampToTime(todo.dueAt))
      if (todo.priority) component.updatePropertyWithValue('priority', todo.priority)
      component.updatePropertyWithValue('status', todo.completed ? 'COMPLETED' : 'NEEDS-ACTION')
      if (todo.completed) {
        component.addPropertyWithValue(
          'completed',
          stampToTime(todo.completedAt ?? new Date().toISOString())
        )
      }
      cal.addSubcomponent(component)
    }
  }
  return cal.toString()
}

/** 解析后的提醒事项（VTODO） */
export interface ParsedVTodo {
  uid: string
  title: string
  notes: string
  /** 截止时间（ISO），无截止为 null */
  dueAt: string | null
  completed: boolean
  completedAt: string | null
  priority: number
}

/** 解析 VCALENDAR 里的所有 VTODO */
export function parseVTodos(icalString: string): ParsedVTodo[] {
  let component: ICAL.Component
  try {
    component = new ICAL.Component(ICAL.parse(icalString))
  } catch {
    return []
  }
  return component.getAllSubcomponents('vtodo').map((todo) => {
    const dueValue = todo.getFirstPropertyValue('due')
    const completedValue = todo.getFirstPropertyValue('completed')
    const status = String(todo.getFirstPropertyValue('status') ?? '').toUpperCase()
    return {
      uid: String(todo.getFirstPropertyValue('uid') ?? ''),
      title: String(todo.getFirstPropertyValue('summary') ?? '未命名提醒'),
      notes: String(todo.getFirstPropertyValue('description') ?? ''),
      dueAt: dueValue instanceof ICAL.Time ? dueValue.toJSDate().toISOString() : null,
      completed: status === 'COMPLETED' || Boolean(completedValue),
      completedAt: completedValue instanceof ICAL.Time ? completedValue.toJSDate().toISOString() : null,
      priority: Number(todo.getFirstPropertyValue('priority') ?? 0) || 0
    }
  })
}

/** 构造 VTODO（勾选完成时回写远端） */
export function buildVTodoString(input: {
  uid: string
  title: string
  notes?: string
  dueAt?: string | null
  completed: boolean
  completedAt?: string | null
  priority?: number
}): string {
  const cal = new ICAL.Component(['vcalendar', [], []])
  cal.updatePropertyWithValue('prodid', '-//myzsk//CN')
  cal.updatePropertyWithValue('version', '2.0')

  const todo = new ICAL.Component('vtodo')
  todo.updatePropertyWithValue('uid', input.uid)
  todo.updatePropertyWithValue('dtstamp', ICAL.Time.now())
  todo.updatePropertyWithValue('summary', input.title || '未命名提醒')
  if (input.notes) todo.updatePropertyWithValue('description', input.notes)
  if (input.dueAt) todo.updatePropertyWithValue('due', stampToTime(input.dueAt))
  if (input.priority) todo.updatePropertyWithValue('priority', input.priority)
  if (input.completed) {
    todo.updatePropertyWithValue('status', 'COMPLETED')
    todo.updatePropertyWithValue(
      'completed',
      stampToTime(input.completedAt ?? new Date().toISOString())
    )
    todo.updatePropertyWithValue('percent-complete', 100)
  } else {
    todo.updatePropertyWithValue('status', 'NEEDS-ACTION')
    todo.updatePropertyWithValue('percent-complete', 0)
  }

  cal.addSubcomponent(todo)
  return cal.toString()
}

export { cryptoRandomId }
