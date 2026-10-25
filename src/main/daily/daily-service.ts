import type { DailyStat } from '../../shared/daily'
import type { Vault } from '../vault'
import type { NotesService } from '../vault'
import type { NoteIndex } from '../vault'
import type { TaskStore } from '../tasks'
import type { SettingsService } from '../settings'
import { DEFAULT_DAILY_TEMPLATE, formatDate, renderTemplate } from './template'

/**
 * 日记服务：按日期创建/打开日记，并提供热图统计。
 */
export class DailyService {
  constructor(
    private readonly vault: Vault,
    private readonly notes: NotesService,
    private readonly settings: SettingsService,
    private readonly taskStore: TaskStore,
    private readonly index: NoteIndex
  ) {}

  /** 打开某天的日记（不存在则套模板创建） */
  async open(dateStamp?: string): Promise<{ path: string }> {
    const settings = this.settings.get()
    const dir = (settings.dailyDir || '日记').replace(/\/+$/, '')
    const format = settings.dailyFormat || 'YYYY-MM-DD'
    const date = dateStamp ? new Date(`${dateStamp}T12:00:00`) : new Date()
    const name = formatDate(date, format)
    const path = `${dir}/${name}.md`

    if (!(await this.vault.exists(path))) {
      // 兼容原有日记：同一天用别的格式命名过（2026-10-23 / 2026_10_23 / 2026年10月23日…）
      const existing = await this.findExistingByDate(dir, date)
      if (existing) return { path: existing }

      // 该日日记曾被删除：从回收站恢复，而不是新建一份空白日记
      const restored = await this.restoreDailyFromTrash(dir, date, name)
      if (restored) return { path: restored }
      const template = settings.dailyTemplate
        ? await this.vault.read(settings.dailyTemplate).catch(() => '')
        : ''
      const content = renderTemplate(template || DEFAULT_DAILY_TEMPLATE, { date, title: name })
      await this.vault.write(path, content)
      await this.notes.refreshNote(path)
    }
    return { path }
  }

  /**
   * 在日记目录里找"同一天但格式不同"的既有文件。
   * 避免用户改过文件名格式后，打开日记变成新建一份空日记。
   */
  private async findExistingByDate(dir: string, date: Date): Promise<string | null> {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const candidates = [
      `${yyyy}-${mm}-${dd}`,
      `${yyyy}_${mm}_${dd}`,
      `${yyyy}.${mm}.${dd}`,
      `${yyyy}${mm}${dd}`,
      `${yyyy}年${Number(mm)}月${Number(dd)}日`,
      `${yyyy}年${Number(mm)}月${dd}日`,
      `${yyyy}年${mm}月${dd}日`,
      `${mm}-${dd}`,
      `${Number(mm)}月${Number(dd)}日`
    ]

    const files = await this.vault.listAllFiles().catch(() => [] as string[])
    const prefix = dir ? `${dir}/` : ''
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.md')) continue
      if (prefix && !file.startsWith(prefix)) continue
      if (prefix && file.slice(prefix.length).includes('/')) continue
      const base = (file.split('/').pop() ?? '').replace(/\.md$/i, '')
      // 去掉「周五」「星期x」「(2)」这类后缀再比较
      const normalized = base.replace(/[\s（(]+[^\s）)]*[）)]?$/g, '').replace(/周[一二三四五六日天]|星期[一二三四五六日天]/g, '').trim()
      if (candidates.some((candidate) => normalized === candidate || normalized.startsWith(candidate))) {
        return file
      }
    }
    return null
  }

  /** 若该日期的日记在回收站里，恢复到原位置 */
  private async restoreDailyFromTrash(
    dir: string,
    date: Date,
    canonicalName: string
  ): Promise<string | null> {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const stems = [
      canonicalName,
      `${yyyy}-${mm}-${dd}`,
      `${yyyy}_${mm}_${dd}`,
      `${yyyy}.${mm}.${dd}`,
      `${yyyy}年${Number(mm)}月${Number(dd)}日`
    ]
    const trash = await this.notes.listTrash().catch(() => [])
    const hit = trash.find((entry) => {
      if (!entry.originalPath.startsWith(`${dir}/`)) return false
      const stem = (entry.originalPath.split('/').pop() ?? '').replace(/\.md$/i, '')
      return stems.some((candidate) => stem === candidate || stem.startsWith(candidate))
    })
    if (!hit) return null
    try {
      const path = await this.notes.restoreFromTrash(hit.name)
      await this.notes.refreshNote(path)
      return path
    } catch {
      return null
    }
  }

  /** 近 N 天的笔记创建数 + 任务完成数 */
  async stats(days = 84): Promise<DailyStat[]> {
    const counts = new Map<string, { notes: number; tasks: number }>()
    const ensure = (day: string): { notes: number; tasks: number } => {
      let entry = counts.get(day)
      if (!entry) {
        entry = { notes: 0, tasks: 0 }
        counts.set(day, entry)
      }
      return entry
    }

    for (const note of this.index.list()) {
      const day = note.createdAt.slice(0, 10)
      if (day) ensure(day).notes += 1
    }
    for (const task of this.taskStore.list('done')) {
      if (task.completedAt) ensure(task.completedAt.slice(0, 10)).tasks += 1
    }

    const out: DailyStat[] = []
    const today = new Date()
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = new Date(today)
      day.setDate(today.getDate() - offset)
      const stamp = formatDate(day, 'YYYY-MM-DD')
      const entry = counts.get(stamp)
      out.push({ date: stamp, notes: entry?.notes ?? 0, tasks: entry?.tasks ?? 0 })
    }
    return out
  }
}
