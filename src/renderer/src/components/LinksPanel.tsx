import type { BacklinkInfo, UnlinkedMention } from '../api'

interface LinksPanelProps {
  backlinks: BacklinkInfo[]
  unlinked: UnlinkedMention[]
  onOpenNote: (path: string) => void
}

/** 反向链接 + 未链接提及（右侧面板的「链接」标签内容） */
export function LinksPanel({ backlinks, unlinked, onOpenNote }: LinksPanelProps): React.JSX.Element {
  return (
    <>
      <div className="links-section">
        <div className="links-section-title">
          反向链接 <span className="links-count">{backlinks.length}</span>
        </div>
        {backlinks.length === 0 && <div className="links-empty">还没有笔记链接到这里</div>}
        <ul className="links-list">
          {backlinks.map((item) => (
            <li key={item.path} className="links-item" onClick={() => onOpenNote(item.path)}>
              <span className="links-item-title">{item.title}</span>
              <span className="links-item-path">{item.path}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="links-section">
        <div className="links-section-title">
          未链接提及 <span className="links-count">{unlinked.length}</span>
        </div>
        {unlinked.length === 0 && <div className="links-empty">没有未链接的提及</div>}
        <ul className="links-list">
          {unlinked.map((item) => (
            <li key={item.path} className="links-item" onClick={() => onOpenNote(item.path)}>
              <span className="links-item-title">{item.title}</span>
              <span
                className="links-item-snippet"
                dangerouslySetInnerHTML={{ __html: item.snippet }}
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
