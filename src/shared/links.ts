/** 链接系统共享类型 */

export interface BacklinkInfo {
  path: string
  title: string
}

export interface UnlinkedMention {
  path: string
  title: string
  /** 含 <mark> 高亮的片段（已转义） */
  snippet: string
}

export interface GraphNode {
  id: string
  title: string
  tags: string[]
  /** note = Markdown 笔记；file = 其他格式文件（图片/PDF 等） */
  kind: 'note' | 'file'
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface LinksApi {
  backlinks(path: string): Promise<BacklinkInfo[]>
  unlinked(path: string): Promise<UnlinkedMention[]>
  graph(): Promise<GraphData>
}
