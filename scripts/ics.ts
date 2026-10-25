/**
 * 导出 / 托管日历数据，供手机（华为、iOS 等）导入或订阅。
 *
 * 用法：
 *   npx vite-node scripts/ics.ts export      # 导出 .ics 到桌面，发送到手机后导入
 *   npx vite-node scripts/ics.ts serve       # 起本地只读 HTTP 订阅服务
 *   npx vite-node scripts/ics.ts serve 8787  # 指定端口
 *
 * 说明：华为纯血鸿蒙没有可调用的「日历/提醒」服务端 API，
 * 所以走标准 iCalendar（.ics）——系统日历能导入或订阅它。
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { buildVCalendar } from '../src/main/calendar/ical'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const dbPath =
  process.env['SECBRAIN_DB'] ?? join(homedir(), 'Library/Application Support/secbrain/secbrain.db')
const db = new DatabaseSync(dbPath, { readOnly: true })

interface EventRow {
  uid: string
  title: string
  description: string
  location: string
  start_at: string
  end_at: string
  rrule: string | null
  reminder_minutes: number | null
}

interface TodoRow {
  uid: string
  title: string
  notes: string
  due_at: string | null
  completed: number
  completed_at: string | null
  priority: number
}

function loadEvents(): EventRow[] {
  return db
    .prepare(
      `SELECT uid, title, description, location, start_at, end_at, rrule, reminder_minutes
         FROM events ORDER BY start_at`
    )
    .all() as unknown as EventRow[]
}

function loadTodos(): TodoRow[] {
  return db
    .prepare(
      `SELECT uid, title, notes, due_at, completed, completed_at, priority
         FROM reminders ORDER BY due_at IS NULL, due_at`
    )
    .all() as unknown as TodoRow[]
}

function calendarIcs(): string {
  return buildVCalendar({
    events: loadEvents().map((row) => ({
      uid: row.uid,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      allDay: row.start_at.length === 10,
      rrule: row.rrule,
      reminderMinutes: row.reminder_minutes
    }))
  })
}

function remindersIcs(): string {
  return buildVCalendar({
    events: [],
    todos: loadTodos().map((row) => ({
      uid: row.uid,
      title: row.title,
      notes: row.notes,
      dueAt: row.due_at,
      completed: Boolean(row.completed),
      completedAt: row.completed_at,
      priority: row.priority
    }))
  })
}

function exportFiles(): void {
  const dir = join(homedir(), 'Desktop')
  mkdirSync(dir, { recursive: true })
  const calendarPath = join(dir, 'secbrain-日历.ics')
  const remindersPath = join(dir, 'secbrain-提醒.ics')
  writeFileSync(calendarPath, calendarIcs(), 'utf8')
  writeFileSync(remindersPath, remindersIcs(), 'utf8')
  console.log(`已导出 ${loadEvents().length} 个日程 → ${calendarPath}`)
  console.log(`已导出 ${loadTodos().length} 条提醒 → ${remindersPath}`)
  console.log(
    '\n下一步：把 .ics 发到手机，用「日历」打开导入（提醒需支持 VTODO 的客户端，多数手机日历不认）。'
  )
}

function lanAddresses(port: number): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(`http://${item.address}:${port}`)
    }
  }
  return out
}

function serve(port = 8787): void {
  const token = process.env['SECBRAIN_ICS_TOKEN'] ?? ''
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    if (token && url.searchParams.get('token') !== token) {
      res.writeHead(401).end('unauthorized')
      return
    }
    const isReminders = url.pathname === '/reminders.ics'
    if (!isReminders && url.pathname !== '/calendar.ics') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('可用地址：/calendar.ics 或 /reminders.ics')
      return
    }

    const body = isReminders ? remindersIcs() : calendarIcs()
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag }).end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-cache',
      etag
    })
    res.end(body)
  })

  server.listen(port, () => {
    const suffix = token ? `?token=${encodeURIComponent(token)}` : ''
    console.log(`ICS 订阅服务已启动（只读）：`)
    for (const base of lanAddresses(port)) {
      console.log(`  日程  ${base}/calendar.ics${suffix}`)
      console.log(`  提醒  ${base}/reminders.ics${suffix}`)
    }
    console.log(`\n手机与电脑需在同一 Wi-Fi。Ctrl+C 停止。`)
  })
}

const [, , command = 'export', portArg] = process.argv
if (command === 'serve') {
  serve(portArg ? Number(portArg) : 8787)
} else {
  exportFiles()
}
