/** 语义检索（本地向量索引）共享类型 */

/** 可选嵌入模型（体积为量化后近似值） */
export const SEMANTIC_MODELS = [
  {
    id: 'Xenova/bge-small-zh-v1.5',
    label: 'bge-small-zh-v1.5 · 512 维 · 约 25MB（下载快）'
  },
  {
    id: 'Xenova/bge-base-zh-v1.5',
    label: 'bge-base-zh-v1.5 · 768 维 · 约 110MB（更准）'
  }
] as const

export interface SemanticStatus {
  enabled: boolean
  model: string
  /** 模型是否已下载并加载成功 */
  modelReady: boolean
  /** 模型下载进度（0-100，未下载时为 null） */
  downloadPercent: number | null
  /** 已索引的笔记数与分块数 */
  indexedNotes: number
  indexedChunks: number
  updating: boolean
  lastIndexedAt: string | null
  error: string | null
}

export interface SemanticHit {
  path: string
  title: string
  snippet: string
  score: number
}

export interface SemanticApi {
  status(): Promise<SemanticStatus>
  setEnabled(enabled: boolean): Promise<SemanticStatus>
  /** 切换嵌入模型（清空旧向量） */
  setModel(model: string): Promise<SemanticStatus>
  rebuild(): Promise<SemanticStatus>
  search(query: string, limit?: number): Promise<SemanticHit[]>
}
