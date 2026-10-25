import type { CalendarService } from '../../calendar'
import type { TaskService } from '../../tasks'
import type { NotesService } from '../../vault'
import type { SemanticService } from '../../semantic'
import type { DocumentIndexer } from '../../indexer'

export interface ToolServices {
  calendar: CalendarService
  tasks: TaskService
  notes: NotesService
  /** 语义检索（未启用时为 null） */
  semantic?: SemanticService | null
  /** 非 Markdown 材料索引（docx/pdf/xlsx 等） */
  documents?: DocumentIndexer | null
}

export interface NoteReference {
  path: string
  title: string
}

export interface ToolExecution {
  output: string
  /** 给人看的一行摘要 */
  summary: string
  isError: boolean
  /** 引用到的笔记（供界面展示） */
  references?: NoteReference[]
}
