import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, linksApi, type GraphData } from '../api'
import { isPreviewable } from '../../../shared/asset-url'
import { openFileViewer } from '../components/FileViewer'

interface Point {
  x: number
  y: number
  vx: number
  vy: number
}

/** 力导向布局迭代（一次性计算，个人库量级足够） */
function computeLayout(data: GraphData): Map<string, Point> {
  const positions = new Map<string, Point>()
  const count = Math.max(1, data.nodes.length)
  const radius = Math.min(420, 120 + count * 5)

  data.nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2
    positions.set(node.id, {
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0
    })
  })

  const iterations = 320
  const repulsion = 4200
  const springLength = 96
  const springStrength = 0.02
  const centerPull = 0.0016

  for (let iter = 0; iter < iterations; iter += 1) {
    // 斥力（节点两两）
    const ids = [...positions.keys()]
    for (let i = 0; i < ids.length; i += 1) {
      const a = positions.get(ids[i]!)!
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = positions.get(ids[j]!)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          distSq = 1
        }
        const force = repulsion / distSq
        const dist = Math.sqrt(distSq)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    // 弹簧（边）
    for (const edge of data.edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const force = (dist - springLength) * springStrength
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // 向心力 + 阻尼
    for (const point of positions.values()) {
      point.vx -= point.x * centerPull
      point.vy -= point.y * centerPull
      point.x += Math.max(-28, Math.min(28, point.vx))
      point.y += Math.max(-28, Math.min(28, point.vy))
      point.vx *= 0.82
      point.vy *= 0.82
    }
  }
  return positions
}

export function GraphView(): React.JSX.Element {
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hideIsolated, setHideIsolated] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layoutRef = useRef<Map<string, Point>>(new Map())
  const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 })
  const degreeRef = useRef<Map<string, number>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    const graph = await linksApi.graph()
    setData(graph)
    layoutRef.current = computeLayout(graph)
    const degree = new Map<string, number>()
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    degreeRef.current = degree
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 只保留有连线的节点（孤立笔记会淹没图谱）
  const viewData = useMemo(() => {
    if (!data || !hideIsolated) return data
    const degree = new Map<string, number>()
    for (const edge of data.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    const nodes = data.nodes.filter((node) => (degree.get(node.id) ?? 0) > 0)
    const ids = new Set(nodes.map((node) => node.id))
    return { nodes, edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }
  }, [data, hideIsolated])

  // 切换过滤后重新布局
  useEffect(() => {
    if (!viewData) return
    layoutRef.current = computeLayout(viewData)
    const degree = new Map<string, number>()
    for (const edge of viewData.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    degreeRef.current = degree
  }, [viewData])

  // 绘制
  useEffect(() => {
    if (!viewData || loading) return
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const dpr = window.devicePixelRatio || 1
    const width = parent.clientWidth
    const height = parent.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const positions = layoutRef.current
    if (positions.size === 0) return

    // 计算包围盒并适配画布
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of positions.values()) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    const graphW = Math.max(1, maxX - minX)
    const graphH = Math.max(1, maxY - minY)
    const padding = 60
    const scale = Math.min((width - padding * 2) / graphW, (height - padding * 2) / graphH, 1.6)
    const offsetX = (width - graphW * scale) / 2 - minX * scale
    const offsetY = (height - graphH * scale) / 2 - minY * scale
    transformRef.current = { scale, offsetX, offsetY }

    const style = getComputedStyle(document.documentElement)
    const textColor = style.getPropertyValue('--text').trim() || '#e6e6e8'
    const dimColor = style.getPropertyValue('--text-dim').trim() || '#8a8b91'
    const accent = style.getPropertyValue('--accent').trim() || '#7c6cf0'
    const border = style.getPropertyValue('--border').trim() || '#2c2d31'

    // 边
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    for (const edge of viewData.edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(a.x * scale + offsetX, a.y * scale + offsetY)
      ctx.lineTo(b.x * scale + offsetX, b.y * scale + offsetY)
      ctx.stroke()
    }

    // 节点：笔记画圆、其他文件画方块
    const showLabels = viewData.nodes.length <= 120
    const fileColor = '#d9a45b'
    for (const node of viewData.nodes) {
      const point = positions.get(node.id)
      if (!point) continue
      const x = point.x * scale + offsetX
      const y = point.y * scale + offsetY
      const degree = degreeRef.current.get(node.id) ?? 0
      const radius = Math.min(9, 3.5 + Math.sqrt(degree) * 2.2)

      ctx.beginPath()
      if (node.kind === 'file') {
        ctx.rect(x - radius, y - radius, radius * 2, radius * 2)
        ctx.fillStyle = fileColor
      } else {
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = degree > 0 ? accent : dimColor
      }
      ctx.fill()

      if (showLabels || degree > 2) {
        ctx.fillStyle = textColor
        ctx.font = '11px -apple-system, "PingFang SC", sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.title.slice(0, 18), x + radius + 4, y)
      }
    }
  }, [viewData, loading])

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!data) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top
    const { scale, offsetX, offsetY } = transformRef.current
    let best: { id: string; dist: number } | null = null
    for (const [id, point] of layoutRef.current) {
      const x = point.x * scale + offsetX
      const y = point.y * scale + offsetY
      const dist = Math.hypot(x - clickX, y - clickY)
      if (dist < 14 && (!best || dist < best.dist)) best = { id, dist }
    }
    if (!best) return
    const node = viewData?.nodes.find((n) => n.id === best!.id)
    if (node?.kind === 'file') {
      if (isPreviewable(node.id)) {
        openFileViewer(node.id, node.title)
      } else {
        void api.openExternal(node.id)
      }
    } else {
      window.dispatchEvent(new CustomEvent('myzsk:open-note', { detail: best.id }))
    }
  }

  return (
    <div className="graph-view">
      <header className="graph-header">
        <div>
          <h1>关系图谱</h1>
          <p className="graph-subtitle">
            {viewData
              ? `${viewData.nodes.filter((n) => n.kind === 'note').length} 篇笔记 · ${
                  viewData.nodes.filter((n) => n.kind === 'file').length
                } 个文件 · ${viewData.edges.length} 条链接`
              : '加载中…'}
          </p>
        </div>
        <div className="graph-actions">
          <label className="graph-toggle">
            <input
              type="checkbox"
              checked={hideIsolated}
              onChange={(e) => setHideIsolated(e.target.checked)}
            />
            隐藏孤立笔记
          </label>
          <button className="btn-ghost" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </header>
      <div className="graph-canvas-wrap">
        {loading && <div className="graph-loading">正在计算布局…</div>}
        {!loading && viewData && viewData.nodes.length === 0 && (
          <div className="graph-loading">知识库还没有笔记</div>
        )}
        <canvas ref={canvasRef} onClick={handleClick} />
        <div className="graph-legend">
          <span>
            <i className="legend-dot note" /> 笔记
          </span>
          <span>
            <i className="legend-dot file" /> 文件（图片/PDF 等）
          </span>
        </div>
      </div>
    </div>
  )
}
