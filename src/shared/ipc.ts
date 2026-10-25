/**
 * 主进程与渲染进程共享的 IPC 契约。
 * 新增能力时在此登记 channel 与类型，preload 与 renderer 都从这里引用。
 */

export type IpcChannel =
  | 'app:ping'
  | 'app:getVersion'
  | 'app:getSettings'
  | 'app:saveSettings'
  | 'vault:list'
  | 'vault:read'
  | 'vault:create'
  | 'vault:update'
  | 'vault:delete'
  | 'vault:search'
  | 'vault:saveAttachment'
  | 'vault:getPath'
  | 'vault:getTree'
  | 'vault:createInDir'
  | 'vault:createDir'
  | 'vault:renameEntry'
  | 'vault:moveEntry'
  | 'vault:deleteEntry'
  | 'vault:listTrash'
  | 'vault:restoreEntry'
  | 'vault:emptyTrash'
  | 'vault:selectDirectory'
  | 'vault:setRoot'
  | 'vault:updateProps'
  | 'shell:openPath'
  | 'links:backlinks'
  | 'links:unlinked'
  | 'links:graph'
  | 'daily:open'
  | 'daily:stats'
  | 'query:run'
  | 'semantic:status'
  | 'semantic:setEnabled'
  | 'semantic:setModel'
  | 'semantic:rebuild'
  | 'semantic:search'
  | 'docs:status'
  | 'docs:rebuild'
  | 'channel:status'
  | 'channel:saveDingTalk'
  | 'channel:reconnect'
  | 'channel:bindingCode'
  | 'channel:unbind'
  | 'calendar:listCalendars'
  | 'calendar:getEvents'
  | 'calendar:createEvent'
  | 'calendar:updateEvent'
  | 'calendar:deleteEvent'
  | 'calendar:checkConflicts'
  | 'calendar:getAccountStatus'
  | 'calendar:connectAccount'
  | 'calendar:disconnectAccount'
  | 'calendar:syncNow'
  | 'calendar:listReminders'
  | 'calendar:setReminderCompleted'
  | 'calendar:listReminderCalendars'
  | 'calendar:createReminder'
  | 'calendar:deleteReminder'
  | 'calendar:getSettings'
  | 'calendar:saveSettings'
  | 'tasks:list'
  | 'tasks:counts'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:complete'
  | 'tasks:delete'
  | 'tasks:convertToEvent'
  | 'butler:chat'
  | 'butler:history'
  | 'butler:clearHistory'
  | 'butler:getConfig'
  | 'butler:saveConfig'
  | 'butler:testConnection'
  | 'butler:listModels'
  | 'butler:probeLocal'
  | 'butler:getContextLimit'
  | 'butler:setContextLimit'

export * from './calendar'
export * from './tasks'
export * from './ai'
export * from './app-settings'
export * from './links'
export * from './daily'
export * from './query'
export * from './semantic'
export * from './docs'
export * from './channel'

/** 主进程推送给渲染层的 Vault 变更事件 */
export type VaultChange =
  | { type: 'upsert'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'tree' }

/** 笔记元信息（来自 SQLite 索引，不含正文） */
export interface NoteMeta {
  /** vault 相对路径，POSIX 风格，如 "日记/2026-10-23.md" */
  path: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** 一篇笔记的完整内容（正文不含 front-matter） */
export interface NoteDoc extends NoteMeta {
  content: string
  /** 自定义 front-matter 属性（title/tags/created 之外，值已转字符串） */
  props: Record<string, string>
}

export interface NoteSearchHit {
  path: string
  title: string
  /** 含 <mark> 高亮的 HTML 片段（已转义） */
  snippet: string
}

export interface CreateNoteInput {
  title?: string
  content?: string
}

export interface UpdateNoteInput {
  path: string
  content: string
  title?: string
}

export interface SaveAttachmentInput {
  /** 笔记的 vault 相对路径 */
  notePath: string
  filename: string
  /** data URL，如 data:image/png;base64,.... */
  dataUrl: string
}

export interface SaveAttachmentResult {
  /** 附件的 vault 相对路径 */
  attachmentPath: string
  /** 可直接插入笔记的 Markdown 图片语法（相对路径已计算） */
  markdown: string
}

import type { CalendarApi } from './calendar'
import type { TaskApi } from './tasks'
import type { ButlerApi } from './ai'
import type { AppSettings } from './app-settings'
import type { LinksApi } from './links'
import type { DailyApi } from './daily'
import type { QueryApi } from './query'
import type { SemanticApi } from './semantic'
import type { DocsApi } from './docs'
import type { ChannelApi } from './channel'

import type { TreeNode, TrashEntry } from './vault'

/** preload 暴露给渲染层的 API 形状（唯一受信任的入口） */
export interface SecBrainApi {
  ping(): Promise<string>
  getVersion(): Promise<string>
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(settings: AppSettings): Promise<AppSettings>
  listNotes(): Promise<NoteMeta[]>
  readNote(path: string): Promise<NoteDoc | null>
  createNote(input: CreateNoteInput): Promise<NoteDoc>
  updateNote(input: UpdateNoteInput): Promise<NoteDoc>
  deleteNote(path: string): Promise<void>
  searchNotes(query: string): Promise<NoteSearchHit[]>
  saveAttachment(input: SaveAttachmentInput): Promise<SaveAttachmentResult>
  getVaultPath(): Promise<string>
  getTree(): Promise<TreeNode[]>
  createInDir(input: { dir: string; title?: string }): Promise<NoteDoc>
  createDir(input: { dir: string; name: string }): Promise<string>
  renameEntry(input: { path: string; newName: string }): Promise<string>
  moveEntry(input: { path: string; targetDir: string }): Promise<string>
  deleteEntry(path: string): Promise<void>
  listTrash(): Promise<TrashEntry[]>
  restoreEntry(name: string): Promise<string>
  emptyTrash(): Promise<number>
  /** 打开系统目录选择对话框，返回选择的路径或 null */
  selectDirectory(): Promise<string | null>
  /** 切换知识库目录（自动重建索引） */
  setRoot(path: string): Promise<string>
  /** 用系统默认应用打开 vault 内文件 */
  openExternal(relPath: string): Promise<void>
  /** 更新笔记的自定义 front-matter 属性 */
  updateProps(input: { path: string; props: Record<string, string> }): Promise<NoteDoc>
  /** 订阅 Vault 文件变更（含外部工具如 Obsidian 的改动），返回取消订阅函数 */
  onVaultChanged(cb: (change: VaultChange) => void): () => void
  calendar: CalendarApi
  tasks: TaskApi
  butler: ButlerApi
  links: LinksApi
  daily: DailyApi
  query: QueryApi
  semantic: SemanticApi
  docs: DocsApi
  channel: ChannelApi
}

declare global {
  interface Window {
    secbrain: SecBrainApi
  }
}
