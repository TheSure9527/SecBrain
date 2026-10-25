import { useMemo } from 'react'
import { extractHeadings } from '../markdown/outline'

interface OutlinePanelProps {
  content: string
  onJump: (line: number) => void
}

/** 笔记大纲：按标题层级缩进，点击跳转到对应行 */
export function OutlinePanel({ content, onJump }: OutlinePanelProps): React.JSX.Element {
  const headings = useMemo(() => extractHeadings(content), [content])

  return (
    <div className="outline-panel">
      {headings.length === 0 && <div className="links-empty">还没有标题</div>}
      {headings.map((heading) => (
        <div
          key={`${heading.line}-${heading.text}`}
          className={`outline-item level-${heading.level}`}
          style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
          onClick={() => onJump(heading.line)}
          title={heading.text}
        >
          {heading.text}
        </div>
      ))}
    </div>
  )
}
