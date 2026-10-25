import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AppSettings } from '../../../shared/app-settings'
import { DEFAULT_APP_SETTINGS } from '../../../shared/app-settings'

const STYLE_ID = 'secbrain-custom-css'

function resolveTheme(mode: AppSettings['theme']): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 应用设置 hook：加载/保存，应用主题（含跟随系统），注入自定义 CSS。
 */
export function useAppSettings(): {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<void>
  loaded: boolean
} {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void api.getAppSettings().then((next) => {
      setSettings(next)
      setLoaded(true)
    })
  }, [])

  // 主题应用 + 跟随系统变化
  useEffect(() => {
    if (!loaded) return
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(settings.theme)
    }
    apply()
    if (settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme, loaded])

  // 自定义 CSS 注入
  useEffect(() => {
    if (!loaded) return
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = settings.customCss
  }, [settings.customCss, loaded])

  const update = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await api.saveAppSettings({ ...settings, ...patch })
    setSettings(next)
  }, [settings])

  return { settings, update, loaded }
}
