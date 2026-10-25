import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiProviderConfig,
  ButlerApi,
  CalDavAccountInput,
  ChannelApi,
  DailyApi,
  DocsApi,
  LinksApi,
  QueryApi,
  SemanticApi,
  CalendarApi,
  CalendarSettings,
  ConflictCheckInput,
  ConvertTaskInput,
  CreateNoteInput,
  CreateEventInput,
  CreateTaskInput,
  MyzskApi,
  SaveAttachmentInput,
  TaskApi,
  TaskFilter,
  UpdateEventInput,
  UpdateNoteInput,
  UpdateTaskInput,
  VaultChange
} from '../shared/ipc'

const calendar: CalendarApi = {
  listCalendars: () => ipcRenderer.invoke('calendar:listCalendars'),
  getEvents: (range) => ipcRenderer.invoke('calendar:getEvents', range),
  createEvent: (input: CreateEventInput) => ipcRenderer.invoke('calendar:createEvent', input),
  updateEvent: (input: UpdateEventInput) => ipcRenderer.invoke('calendar:updateEvent', input),
  deleteEvent: (id: string) => ipcRenderer.invoke('calendar:deleteEvent', id),
  checkConflicts: (input: ConflictCheckInput) => ipcRenderer.invoke('calendar:checkConflicts', input),
  getAccountStatus: () => ipcRenderer.invoke('calendar:getAccountStatus'),
  connectAccount: (input: CalDavAccountInput) => ipcRenderer.invoke('calendar:connectAccount', input),
  disconnectAccount: () => ipcRenderer.invoke('calendar:disconnectAccount'),
  syncNow: () => ipcRenderer.invoke('calendar:syncNow'),
  listReminders: (includeCompleted?: boolean) =>
    ipcRenderer.invoke('calendar:listReminders', includeCompleted),
  setReminderCompleted: (calendarId: string, uid: string, completed: boolean) =>
    ipcRenderer.invoke('calendar:setReminderCompleted', calendarId, uid, completed),
  listReminderCalendars: () => ipcRenderer.invoke('calendar:listReminderCalendars'),
  createReminder: (input) => ipcRenderer.invoke('calendar:createReminder', input),
  deleteReminder: (calendarId: string, uid: string) =>
    ipcRenderer.invoke('calendar:deleteReminder', calendarId, uid),
  getSettings: () => ipcRenderer.invoke('calendar:getSettings'),
  saveSettings: (settings: CalendarSettings) => ipcRenderer.invoke('calendar:saveSettings', settings)
}

const daily: DailyApi = {
  open: (date?: string) => ipcRenderer.invoke('daily:open', date),
  stats: (days?: number) => ipcRenderer.invoke('daily:stats', days)
}

const query: QueryApi = {
  run: (text: string) => ipcRenderer.invoke('query:run', text)
}

const docs: DocsApi = {
  status: () => ipcRenderer.invoke('docs:status'),
  rebuild: () => ipcRenderer.invoke('docs:rebuild')
}

const channel: ChannelApi = {
  status: () => ipcRenderer.invoke('channel:status'),
  saveDingTalk: (input) => ipcRenderer.invoke('channel:saveDingTalk', input),
  reconnect: () => ipcRenderer.invoke('channel:reconnect'),
  generateBindingCode: () => ipcRenderer.invoke('channel:bindingCode'),
  unbind: (userId: string) => ipcRenderer.invoke('channel:unbind', userId)
}

const semantic: SemanticApi = {
  status: () => ipcRenderer.invoke('semantic:status'),
  setEnabled: (enabled: boolean) => ipcRenderer.invoke('semantic:setEnabled', enabled),
  setModel: (model: string) => ipcRenderer.invoke('semantic:setModel', model),
  rebuild: () => ipcRenderer.invoke('semantic:rebuild'),
  search: (query: string, limit?: number) => ipcRenderer.invoke('semantic:search', query, limit)
}

const links: LinksApi = {
  backlinks: (path: string) => ipcRenderer.invoke('links:backlinks', path),
  unlinked: (path: string) => ipcRenderer.invoke('links:unlinked', path),
  graph: () => ipcRenderer.invoke('links:graph')
}

const tasks: TaskApi = {
  list: (filter: TaskFilter) => ipcRenderer.invoke('tasks:list', filter),
  counts: () => ipcRenderer.invoke('tasks:counts'),
  create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
  update: (input: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', input),
  complete: (id: string, done: boolean) => ipcRenderer.invoke('tasks:complete', id, done),
  delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
  convertToEvent: (input: ConvertTaskInput) => ipcRenderer.invoke('tasks:convertToEvent', input)
}

const butler: ButlerApi = {
  chat: (input) => ipcRenderer.invoke('butler:chat', input),
  history: () => ipcRenderer.invoke('butler:history'),
  clearHistory: () => ipcRenderer.invoke('butler:clearHistory'),
  getContextLimit: () => ipcRenderer.invoke('butler:getContextLimit'),
  setContextLimit: (limit: number) => ipcRenderer.invoke('butler:setContextLimit', limit),
  getConfig: () => ipcRenderer.invoke('butler:getConfig'),
  saveConfig: (config: AiProviderConfig) => ipcRenderer.invoke('butler:saveConfig', config),
  testConnection: () => ipcRenderer.invoke('butler:testConnection'),
  listModels: () => ipcRenderer.invoke('butler:listModels'),
  probeLocal: () => ipcRenderer.invoke('butler:probeLocal')
}

const api: MyzskApi = {
  ping: () => ipcRenderer.invoke('app:ping'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getAppSettings: () => ipcRenderer.invoke('app:getSettings'),
  saveAppSettings: (settings) => ipcRenderer.invoke('app:saveSettings', settings),
  listNotes: () => ipcRenderer.invoke('vault:list'),
  readNote: (path: string) => ipcRenderer.invoke('vault:read', path),
  createNote: (input: CreateNoteInput) => ipcRenderer.invoke('vault:create', input),
  updateNote: (input: UpdateNoteInput) => ipcRenderer.invoke('vault:update', input),
  deleteNote: (path: string) => ipcRenderer.invoke('vault:delete', path),
  searchNotes: (query: string) => ipcRenderer.invoke('vault:search', query),
  saveAttachment: (input: SaveAttachmentInput) => ipcRenderer.invoke('vault:saveAttachment', input),
  getVaultPath: () => ipcRenderer.invoke('vault:getPath'),
  getTree: () => ipcRenderer.invoke('vault:getTree'),
  createInDir: (input) => ipcRenderer.invoke('vault:createInDir', input),
  createDir: (input) => ipcRenderer.invoke('vault:createDir', input),
  renameEntry: (input) => ipcRenderer.invoke('vault:renameEntry', input),
  moveEntry: (input) => ipcRenderer.invoke('vault:moveEntry', input),
  deleteEntry: (path: string) => ipcRenderer.invoke('vault:deleteEntry', path),
  listTrash: () => ipcRenderer.invoke('vault:listTrash'),
  restoreEntry: (name: string) => ipcRenderer.invoke('vault:restoreEntry', name),
  emptyTrash: () => ipcRenderer.invoke('vault:emptyTrash'),
  selectDirectory: () => ipcRenderer.invoke('vault:selectDirectory'),
  setRoot: (path: string) => ipcRenderer.invoke('vault:setRoot', path),
  openExternal: (relPath: string) => ipcRenderer.invoke('shell:openPath', relPath),
  updateProps: (input) => ipcRenderer.invoke('vault:updateProps', input),
  onVaultChanged: (cb: (change: VaultChange) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, change: VaultChange): void => cb(change)
    ipcRenderer.on('vault:changed', listener)
    return () => {
      ipcRenderer.removeListener('vault:changed', listener)
    }
  },
  calendar,
  tasks,
  butler,
  links,
  daily,
  query,
  semantic,
  docs,
  channel
}

contextBridge.exposeInMainWorld('myzsk', api)
