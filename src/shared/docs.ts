/** 非 Markdown 材料索引（docx/pdf/xlsx/文本）共享类型 */

export interface DocumentIssue {
  path: string
  reason: string
}

export interface DocumentStatus {
  count: number
  indexing: boolean
  lastIndexedAt: string | null
  supported: string[]
  /** 未能读取的文件及原因（最多 20 条） */
  issues: DocumentIssue[]
}

export interface DocsApi {
  status(): Promise<DocumentStatus>
  /** 重新扫描并索引全部材料 */
  rebuild(): Promise<DocumentStatus>
}
