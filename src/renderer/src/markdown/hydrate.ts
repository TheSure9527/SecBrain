import { api } from '../api'

/**
 * 富内容水合：把渲染出的占位元素（数学公式 / Mermaid / 查询）替换为真实内容。
 * 依赖动态 import，避免拖慢首屏。
 */

let mermaidReady = false

async function loadMermaid(): Promise<typeof import('mermaid').default | null> {
  try {
    const mod = await import('mermaid')
    const mermaid = mod.default
    if (!mermaidReady) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
      mermaidReady = true
    }
    return mermaid
  } catch {
    return null
  }
}

/** 执行容器内的 ```query 块并渲染为表格 */
export async function hydrateQueryBlocks(root: HTMLElement): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.query-block'))
  for (const block of blocks) {
    const source = block.dataset.query ?? ''
    block.textContent = '查询中…'
    try {
      const result = await api.query.run(source)
      block.textContent = ''
      if (result.error) {
        block.textContent = `查询错误：${result.error}`
        block.classList.add('query-error')
        continue
      }
      const table = document.createElement('table')
      const headRow = table.createTHead().insertRow()
      for (const column of result.columns) {
        const th = document.createElement('th')
        th.textContent = column
        headRow.appendChild(th)
      }
      const tbody = table.createTBody()
      for (const row of result.rows) {
        const tr = tbody.insertRow()
        for (const column of result.columns) {
          tr.insertCell().textContent = row[column] ?? ''
        }
      }
      block.appendChild(table)
      if (result.rows.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'query-empty'
        empty.textContent = '没有匹配的笔记'
        block.appendChild(empty)
      }
    } catch (err) {
      block.textContent = `查询失败：${err instanceof Error ? err.message : String(err)}`
      block.classList.add('query-error')
    }
  }
}

/** 渲染容器内的数学公式与 Mermaid 图表 */
export async function hydrateRichContent(root: HTMLElement): Promise<void> {
  // ---- KaTeX ----
  const mathEls = Array.from(root.querySelectorAll<HTMLElement>('[data-math]'))
  if (mathEls.length > 0) {
    try {
      const katex = (await import('katex')).default
      for (const el of mathEls) {
        const source = el.dataset.math ?? ''
        const displayMode = el.classList.contains('math-block')
        try {
          katex.render(source, el, { throwOnError: false, displayMode })
        } catch {
          el.textContent = source
          el.classList.add('math-error')
        }
      }
    } catch {
      for (const el of mathEls) el.textContent = el.dataset.math ?? ''
    }
  }

  // ---- Mermaid ----
  const mermaidEls = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
  if (mermaidEls.length > 0) {
    const mermaid = await loadMermaid()
    if (!mermaid) {
      for (const el of mermaidEls) {
        el.textContent = el.dataset.mermaid ?? ''
        el.classList.add('mermaid-error')
      }
      return
    }
    for (const [index, el] of mermaidEls.entries()) {
      const source = el.dataset.mermaid ?? ''
      try {
        const { svg } = await mermaid.render(`mermaid-${Date.now()}-${index}`, source)
        el.innerHTML = svg
        el.classList.add('mermaid-rendered')
      } catch {
        el.textContent = source
        el.classList.add('mermaid-error')
      }
    }
  }
}
