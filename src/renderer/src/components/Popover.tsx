import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PopoverProps {
  /** 触发元素（用于定位） */
  anchor: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
  /** 期望宽度 */
  width?: number
}

/**
 * 轻量弹层：fixed 定位在锚点下方，点击外部或 Esc 关闭。
 * 用于日期/时间选择器，避免被弹窗 body 的 overflow 裁剪。
 */
export function Popover({ anchor, onClose, children, width = 280 }: PopoverProps): React.JSX.Element | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const left = Math.min(rect.left, window.innerWidth - width - 12)
    const belowSpace = window.innerHeight - rect.bottom
    const top = belowSpace < 320 ? Math.max(12, rect.top - 320) : rect.bottom + 6
    setPos({ left: Math.max(12, left), top })
  }, [anchor, width])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (ref.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    // 延迟绑定，避免打开瞬间的 click 立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor, onClose])

  if (!pos) return null
  return (
    <div
      ref={ref}
      className="popover"
      style={{ left: pos.left, top: pos.top, width }}
    >
      {children}
    </div>
  )
}
