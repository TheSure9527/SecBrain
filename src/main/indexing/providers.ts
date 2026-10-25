import type { NoteIndex } from '../vault'
import type { LinkGraph } from '../vault'
import type { SemanticService } from '../semantic'
import type { NoteProp } from '../vault'
import type { IndexProvider, DocSnapshot } from './index-coordinator'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 全文 + 属性索引（同一个 provider：两者必须同时成功） */
export class NoteSearchProvider implements IndexProvider {
  readonly name = 'note-search'

  constructor(private readonly index: NoteIndex) {}

  async upsert(doc: DocSnapshot): Promise<void> {
    const tags = Array.isArray(doc.meta.tags) ? (doc.meta.tags as string[]) : []
    this.index.upsert({
      path: doc.sourceId,
      title: asString(doc.meta.title, doc.sourceId),
      tags,
      createdAt: asString(doc.meta.createdAt, new Date(doc.updatedAt).toISOString()),
      updatedAt: new Date(doc.updatedAt).toISOString(),
      content: doc.text
    })
    const props = Array.isArray(doc.meta.props) ? (doc.meta.props as NoteProp[]) : []
    this.index.setProps(doc.sourceId, props)
  }

  async invalidate(docId: string): Promise<void> {
    this.index.remove(docId)
  }

  async rebuildAll(): Promise<void> {
    // 全量重建由 NotesService 扫描驱动，这里只清空
    this.index.clearAll()
  }
}

/** 链接图索引 */
export class LinkGraphProvider implements IndexProvider {
  readonly name = 'link-graph'

  constructor(private readonly links: LinkGraph) {}

  async upsert(doc: DocSnapshot): Promise<void> {
    await this.links.indexNote(doc.sourceId, doc.text)
  }

  async invalidate(docId: string): Promise<void> {
    this.links.removeNote(docId)
  }

  async rebuildAll(): Promise<void> {
    this.links.clearAll()
  }
}

/** 语义向量索引（未启用时 SeminarService 内部会忽略） */
export class SemanticProvider implements IndexProvider {
  readonly name = 'semantic'

  constructor(private readonly semantic: SemanticService) {}

  async upsert(doc: DocSnapshot): Promise<void> {
    this.semantic.onNoteChanged(doc.sourceId)
  }

  async invalidate(docId: string): Promise<void> {
    this.semantic.removeNote(docId)
  }
}
