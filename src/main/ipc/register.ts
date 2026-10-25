import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type {
  AiProviderConfig,
  AppSettings,
  CalDavAccountInput,
  CalendarSettings,
  ConflictCheckInput,
  ConvertTaskInput,
  CreateEventInput,
  CreateTaskInput,
  IpcChannel,
  SaveAttachmentInput,
  TaskFilter,
  UpdateEventInput,
  UpdateNoteInput,
  UpdateTaskInput,
  VaultChange
} from '../../shared/ipc'
import { openDatabase } from '../db'
import { Vault, NoteIndex, NotesService, LinkGraph } from '../vault'
import {
  EventStore,
  CalDavClient,
  SyncEngine,
  CalendarService,
  ReminderScheduler
} from '../calendar'
import { TaskStore, TaskService } from '../tasks'
import { ButlerService } from '../ai'
import { SettingsService } from '../settings'
import { DailyService, formatDate } from '../daily'
import { QueryExecutor } from '../query'
import { SemanticService } from '../semantic'
import { DocumentIndexer } from '../indexer'
import { IndexCoordinator, LinkGraphProvider, NoteSearchProvider, SemanticProvider } from '../indexing'
import { DingTalkService } from '../channel'

export interface AppServices {
  notes: NotesService
  calendar: CalendarService
  tasks: TaskService
  butler: ButlerService
  reminders: ReminderScheduler
}

export function getVaultRoot(settings?: SettingsService): string {
  const saved = settings?.get().vaultRoot
  if (saved) return saved
  return process.env['SECBRAIN_VAULT'] ?? join(app.getPath('home'), 'secbrain-vault')
}

export function registerServices(): AppServices {
  const db = openDatabase(join(app.getPath('userData'), 'secbrain.db'))

  // ---------- 应用设置（Vault 路径依赖它） ----------
  const settings = new SettingsService(db)

  // ---------- 知识库 ----------
  const vault = new Vault(getVaultRoot(settings))
  const noteIndex = new NoteIndex(db)

  const emitVaultChange = (change: VaultChange): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('vault:changed', change)
    }
  }

  const linkGraph = new LinkGraph(db, vault, noteIndex)
  const notes = new NotesService(vault, noteIndex, emitVaultChange, linkGraph)
  void notes.init()

  // ---------- 日历 ----------
  const eventStore = new EventStore(db)
  eventStore.ensureLocalCalendar()

  // CalDAV 客户端由 CalendarService 与 SyncEngine 共享，保证读写同一连接
  const caldavClient = new CalDavClient()
  const syncEngine = new SyncEngine(caldavClient, eventStore)
  const calendar = new CalendarService(eventStore, caldavClient)
  calendar.attachSyncEngine(syncEngine)

  // ---------- 任务 ----------
  const taskStore = new TaskStore(db)
  const tasks = new TaskService(taskStore, calendar)

  // ---------- 材料索引（docx/pdf/xlsx/文本） ----------
  const documents = new DocumentIndexer(db, vault)
  void documents.watch()
  void documents.rebuild()
  // 启动时可能有文件正在写入/拷贝，90 秒后再补扫一次（未变更文件会跳过）
  setTimeout(() => void documents.rebuild(), 90_000)

  // ---------- 语义检索 ----------
  const semantic = new SemanticService(
    db,
    notes,
    noteIndex,
    settings,
    join(app.getPath('userData'), 'models'),
    undefined,
    documents
  )
  // 索引唯一入口：全文+属性、链接图、语义向量
  notes.setIndexCoordinator(
    new IndexCoordinator([
      new NoteSearchProvider(noteIndex),
      new LinkGraphProvider(linkGraph),
      new SemanticProvider(semantic)
    ])
  )
  // 材料变更 → 语义索引增量（否则新简历永远搜不到语义结果）
  documents.setChangeListener({
    upsert: (path) => void semantic.indexDocument(path),
    remove: (path) => semantic.removeNote(path)
  })
  void semantic.ensureIndex()

  // ---------- AI 管家 ----------
  const butler = new ButlerService(db, { calendar, tasks, notes, semantic, documents })

  // ---------- 渠道（钉钉单聊） ----------
  const dingtalk = new DingTalkService(db, butler)
  if (dingtalk.getConfig().enabled) void dingtalk.connect()

  // ---------- 日记 ----------
  const daily = new DailyService(vault, notes, settings, taskStore, noteIndex)

  // ---------- Dataview 式查询 ----------
  const query = new QueryExecutor(db)

  const reminders = new ReminderScheduler(
    eventStore,
    (event) => calendar.notifyReminder(event),
    {
      store: taskStore,
      onDue: (task) => tasks.notifyDue(task)
    }
  )
  reminders.start()

  // 启动时恢复已保存的 CalDAV 账号
  void calendar.restoreAccount().then((status) => {
    if (status.status === 'connected') {
      void calendar.syncNow()
    }
  })

  // ---------- IPC handlers ----------
  const handlers: Record<
    IpcChannel,
    (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown
  > = {
    'app:ping': async () => 'pong',
    'app:getVersion': async () => app.getVersion(),
    'app:getSettings': () => settings.get(),
    'app:saveSettings': (_e, next: AppSettings) => settings.save(next),

    'vault:list': () => notes.listNotes(),
    'vault:read': (_e, path: string) => notes.readNote(path),
    'vault:create': (_e, input) => notes.createNote(input),
    'vault:update': (_e, input: UpdateNoteInput) => notes.updateNote(input),
    'vault:delete': (_e, path: string) => notes.deleteNote(path),
    'vault:search': (_e, query: string) => notes.searchNotes(query),
    'vault:saveAttachment': (_e, input: SaveAttachmentInput) => notes.saveAttachment(input),
    'vault:getPath': () => notes.vaultRoot,
    'vault:selectDirectory': async () => {
      const result = await dialog.showOpenDialog({
        title: '选择知识库文件夹',
        properties: ['openDirectory', 'createDirectory'],
        message: '选择存放 Markdown 笔记的文件夹（可直接选已有的 Obsidian vault）'
      })
      return result.filePaths[0] ?? null
    },
    'vault:updateProps': (_e, input: { path: string; props: Record<string, string> }) =>
      notes.updateProps(input.path, input.props),
    'vault:setRoot': async (_e, path: string) => {
      // 空路径 = 恢复默认（~/secbrain-vault）
      const target = path.trim() ? path : getVaultRoot()
      settings.save({ ...settings.get(), vaultRoot: path.trim() })
      await notes.switchVault(target)
      return notes.vaultRoot
    },
    'shell:openPath': async (_e, relPath: string) => {
      const abs = notes.absPath(relPath)
      const error = await shell.openPath(abs)
      if (error) throw new Error(error)
    },

    'links:backlinks': (_e, path: string) => notes.backlinks(path),
    'links:unlinked': (_e, path: string) => notes.unlinkedMentions(path),
    'links:graph': () => notes.graph(),

    'daily:open': (_e, date?: string) => daily.open(date),
    'daily:stats': (_e, days?: number) => daily.stats(days),

    'query:run': (_e, text: string) => query.run(text),

    'semantic:status': () => semantic.status(),
    'semantic:setEnabled': (_e, enabled: boolean) => semantic.setEnabled(enabled),
    'semantic:setModel': (_e, model: string) => semantic.setModel(model),
    'semantic:rebuild': () => semantic.rebuild(),
    'semantic:search': (_e, text: string, limit?: number) => semantic.search(text, limit),

    'channel:status': () => dingtalk.status(),
    'channel:saveDingTalk': (_e, input) => dingtalk.saveConfig(input),
    'channel:reconnect': () => dingtalk.connect(),
    'channel:bindingCode': () => dingtalk.generateBindingCode(),
    'channel:unbind': (_e, userId: string) => {
      dingtalk.unbind(userId)
      return dingtalk.status()
    },

    'docs:status': () => documents.status(),
    'docs:rebuild': () => documents.rebuild(true),
    'vault:getTree': () => notes.listTree(),
    'vault:createInDir': (_e, input: { dir: string; title?: string }) => {
      const appSettings = settings.get()
      const dailyDir = (appSettings.dailyDir || '日记').replace(/\/+$/, '')
      const isDaily = input.dir.replace(/\/+$/, '') === dailyDir
      // 日记目录下新建笔记：默认按「年-月-日」命名，而不是「未命名」
      const fallback = isDaily
        ? formatDate(new Date(), appSettings.dailyFormat || 'YYYY-MM-DD')
        : undefined
      return notes.createFileInDir(input.dir, input.title?.trim() || fallback)
    },
    'vault:createDir': (_e, input: { dir: string; name: string }) =>
      notes.createDir(input.dir, input.name),
    'vault:renameEntry': (_e, input: { path: string; newName: string }) =>
      notes.renameEntry(input.path, input.newName),
    'vault:moveEntry': (_e, input: { path: string; targetDir: string }) =>
      notes.moveEntry(input.path, input.targetDir),
    'vault:deleteEntry': (_e, path: string) => notes.deleteEntry(path),
    'vault:listTrash': () => notes.listTrash(),
    'vault:restoreEntry': (_e, name: string) => notes.restoreFromTrash(name),
    'vault:emptyTrash': () => notes.emptyTrash(),

    'calendar:listCalendars': () => calendar.listCalendars(),
    'calendar:getEvents': (_e, range: { start: string; end: string }) => calendar.getEvents(range),
    'calendar:createEvent': (_e, input: CreateEventInput) => calendar.createEvent(input),
    'calendar:updateEvent': (_e, input: UpdateEventInput) => calendar.updateEvent(input),
    'calendar:deleteEvent': (_e, id: string) => calendar.deleteEvent(id),
    'calendar:checkConflicts': (_e, input: ConflictCheckInput) => calendar.checkConflicts(input),
    'calendar:getAccountStatus': () => calendar.getAccountStatus(),
    'calendar:connectAccount': (_e, input: CalDavAccountInput) => calendar.connectAccount(input),
    'calendar:disconnectAccount': () => calendar.disconnectAccount(),
    'calendar:syncNow': () => calendar.syncNow(),
    'calendar:listReminders': (_e, includeCompleted?: boolean) =>
      calendar.listReminders(includeCompleted),
    'calendar:setReminderCompleted': (_e, calendarId: string, uid: string, completed: boolean) =>
      calendar.setReminderCompleted(calendarId, uid, completed),
    'calendar:listReminderCalendars': () => calendar.listReminderCalendars(),
    'calendar:createReminder': (_e, input) => calendar.createReminder(input),
    'calendar:deleteReminder': (_e, calendarId: string, uid: string) =>
      calendar.deleteReminder(calendarId, uid),
    'calendar:getSettings': () => calendar.getSettings(),
    'calendar:saveSettings': (_e, settings: CalendarSettings) => calendar.saveSettings(settings),

    'tasks:list': (_e, filter: TaskFilter) => tasks.list(filter),
    'tasks:counts': () => tasks.counts(),
    'tasks:create': (_e, input: CreateTaskInput) => tasks.create(input),
    'tasks:update': (_e, input: UpdateTaskInput) => tasks.update(input),
    'tasks:complete': (_e, id: string, done: boolean) => tasks.complete(id, done),
    'tasks:delete': (_e, id: string) => tasks.delete(id),
    'tasks:convertToEvent': (_e, input: ConvertTaskInput) => tasks.convertToEvent(input),

    'butler:chat': (_e, input: { text: string }) => butler.chat(input.text),
    'butler:history': () => butler.history(),
    'butler:getContextLimit': () => butler.getContextLimit(),
    'butler:setContextLimit': (_e, limit: number) => butler.setContextLimit(limit),
    'butler:clearHistory': () => butler.clearHistory(),
    'butler:getConfig': () => butler.getConfig(),
    'butler:saveConfig': (_e, config: AiProviderConfig) => butler.saveConfig(config),
    'butler:testConnection': () => butler.testConnection(),
    'butler:listModels': () => butler.listModels(),
    'butler:probeLocal': () => butler.probeLocal()
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    // handler 的具体参数类型在 Record 声明处保证，这里向 ipcMain.handle 的宽签名收窄
    ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
  }

  return { notes, calendar, tasks, butler, reminders }
}
