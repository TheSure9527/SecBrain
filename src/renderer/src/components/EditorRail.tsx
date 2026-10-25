/** 折叠态的行号缩略栏：只显示数字，点击可跳转到对应行 */

interface EditorRailProps {
  lineCount: number
  onJump: (line: number) => void
}

export function EditorRail({ lineCount, onJump }: EditorRailProps): React.JSX.Element {
  const lines = Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1)
  return (
    <div className="editor-rail" title="点击行号跳转">
      {lines.map((line) => (
        <button
          key={line}
          type="button"
          className="editor-rail-num"
          onClick={() => onJump(line)}
        >
          {line}
        </button>
      ))}
    </div>
  )
}
