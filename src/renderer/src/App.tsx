import { useCallback, useEffect, useState } from 'react'
import { NotesView } from './views/NotesView'
import { CalendarView } from './views/CalendarView'
import { RemindersView } from './views/RemindersView'
import { GraphView } from './views/GraphView'
import { ButlerView } from './views/ButlerView'
import { SettingsView } from './views/SettingsView'
import { CommandPalette, QuickSwitcher } from './components/CommandPalette'
import { FileViewer, baseName, type OpenFilePayload } from './components/FileViewer'
import { registerCommands, useCommands, type Command } from './commands/registry'
import { useAppSettings } from './hooks/useAppSettings'
import { api } from './api'

type ViewKey = 'notes' | 'calendar' | 'reminders' | 'graph' | 'butler' | 'settings'

const NAV: Array<{ key: ViewKey; label: string }> = [
  { key: 'notes', label: '笔记' },
  { key: 'calendar', label: '日历' },
  { key: 'reminders', label: '提醒' },
  { key: 'graph', label: '图谱' },
  { key: 'butler', label: '管家' },
  { key: 'settings', label: '设置' }
]

export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewKey>('notes')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [viewerFile, setViewerFile] = useState<OpenFilePayload | null>(null)
  const { settings, update } = useAppSettings()
  const commands = useCommands()

  // 全局文件查看器（图片/PDF/音视频）
  useEffect(() => {
    const onOpenFile = (event: Event): void => {
      const payload = (event as CustomEvent<OpenFilePayload>).detail
      if (payload?.path) setViewerFile(payload)
    }
    window.addEventListener('secbrain:open-file', onOpenFile)
    return () => window.removeEventListener('secbrain:open-file', onOpenFile)
  }, [])

  const openNote = useCallback((path: string) => {
    setView('notes')
    // 通知 NotesView 打开指定笔记
    window.dispatchEvent(new CustomEvent('secbrain:open-note', { detail: path }))
  }, [])

  const toggleTheme = useCallback(() => {
    const current = settings.theme === 'light' ? 'light' : 'dark'
    void update({ theme: current })
  }, [settings.theme, update])

  // 注册全局命令
  useEffect(() => {
    const list: Command[] = [
      {
        id: 'note.new',
        title: '新建笔记',
        section: '笔记',
        run: () => {
          setView('notes')
          void api.createNote({ title: '未命名笔记' }).then((doc) => openNote(doc.path))
        }
      },
      { id: 'view.notes', title: '跳转到：笔记', section: '导航', shortcut: '⌘1', run: () => setView('notes') },
      { id: 'view.calendar', title: '跳转到：日历', section: '导航', shortcut: '⌘2', run: () => setView('calendar') },
      { id: 'view.reminders', title: '跳转到：提醒', section: '导航', shortcut: '⌘3', run: () => setView('reminders') },
      { id: 'view.graph', title: '跳转到：关系图谱', section: '导航', shortcut: '⌘4', run: () => setView('graph') },
      { id: 'view.butler', title: '跳转到：管家', section: '导航', shortcut: '⌘5', run: () => setView('butler') },
      { id: 'view.settings', title: '跳转到：设置', section: '导航', shortcut: '⌘,', run: () => setView('settings') },
      {
        id: 'daily.today',
        title: '打开今天日记',
        section: '日记',
        shortcut: '⌘D',
        run: () => {
          setView('notes')
          void api.daily.open().then(({ path }) => openNote(path))
        }
      },
      {
        id: 'daily.panel',
        title: '日记热图与历史',
        section: '日记',
        run: () => {
          setView('notes')
          window.dispatchEvent(new CustomEvent('secbrain:open-daily-panel'))
        }
      },
      { id: 'palette.open', title: '命令面板', section: '效率', shortcut: '⌘P', run: () => setPaletteOpen(true) },
      { id: 'switcher.open', title: '快速切换笔记', section: '效率', shortcut: '⌘O', run: () => setSwitcherOpen(true) },
      {
        id: 'theme.toggle',
        title: '切换明暗主题',
        section: '外观',
        run: toggleTheme
      },
      {
        id: 'calendar.sync',
        title: '立即同步日历',
        section: '日历',
        run: () => {
          void api.calendar.syncNow()
        }
      },
      {
        id: 'reminder.new',
        title: '打开提醒（新建待办）',
        section: '提醒',
        run: () => setView('reminders')
      },
      {
        id: 'butler.clear',
        title: '清空管家对话',
        section: '管家',
        run: () => {
          void api.butler.clearHistory()
        }
      }
    ]
    return registerCommands(list)
  }, [openNote, toggleTheme])

  // 全局快捷键
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'p') {
        event.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (key === 'o') {
        event.preventDefault()
        setSwitcherOpen(true)
      } else if (key === '1') {
        event.preventDefault()
        setView('notes')
      } else if (key === '2') {
        event.preventDefault()
        setView('calendar')
      } else if (key === '3') {
        event.preventDefault()
        setView('reminders')
      } else if (key === '4') {
        event.preventDefault()
        setView('graph')
      } else if (key === '5') {
        event.preventDefault()
        setView('butler')
      } else if (key === 'd') {
        event.preventDefault()
        setView('notes')
        void api.daily.open().then(({ path }) => openNote(path))
      } else if (key === ',') {
        event.preventDefault()
        setView('settings')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">SecBrain</div>
        <nav>
          {NAV.map((item) => (
            <span
              key={item.key}
              className={`nav-item ${item.key === view ? 'active' : ''}`}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </span>
          ))}
        </nav>
      </aside>
      <main className="content">
        {view === 'notes' && <NotesView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'reminders' && <RemindersView />}
        {view === 'graph' && <GraphView />}
        {view === 'butler' && <ButlerView />}
        {view === 'settings' && <SettingsView />}
      </main>

      {paletteOpen && (
        <CommandPalette
          commands={commands}
          onClose={() => setPaletteOpen(false)}
          onOpenNote={openNote}
        />
      )}
      {switcherOpen && (
        <QuickSwitcher onClose={() => setSwitcherOpen(false)} onOpenNote={openNote} />
      )}
      {viewerFile && (
        <FileViewer
          path={viewerFile.path}
          name={viewerFile.name ?? baseName(viewerFile.path)}
          onClose={() => setViewerFile(null)}
        />
      )}
    </div>
  )
}
