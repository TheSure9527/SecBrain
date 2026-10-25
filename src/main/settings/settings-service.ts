import { nativeTheme } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { AppSettings } from '../../shared/app-settings'
import { DEFAULT_APP_SETTINGS } from '../../shared/app-settings'

const KEY = 'app.settings'

/** 应用设置服务：主题偏好与自定义 CSS（存 meta 表） */
export class SettingsService {
  constructor(private readonly db: DatabaseSync) {
    // 启动时恢复主题偏好（影响原生控件）
    const settings = this.get()
    this.applyNativeTheme(settings.theme)
  }

  get(): AppSettings {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as
      | { value: string }
      | undefined
    if (!row) return { ...DEFAULT_APP_SETTINGS }
    try {
      return { ...DEFAULT_APP_SETTINGS, ...(JSON.parse(row.value) as Partial<AppSettings>) }
    } catch {
      return { ...DEFAULT_APP_SETTINGS }
    }
  }

  save(settings: AppSettings): AppSettings {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(KEY, JSON.stringify(settings))
    this.applyNativeTheme(settings.theme)
    return this.get()
  }

  private applyNativeTheme(theme: AppSettings['theme']): void {
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme
  }
}
