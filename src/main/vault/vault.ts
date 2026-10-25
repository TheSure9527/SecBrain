import { watch, type FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm, readdir, stat, rename, copyFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, sep, basename } from 'node:path'
import { slugify } from './note-file'
import type { TreeNode, TrashEntry } from '../../shared/vault'

export type { TreeNode, TrashEntry }

export interface VaultFileEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  /** vault 相对路径（POSIX） */
  path: string
}

const ALLOWED_ATTACHMENT_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf'
])

const TRASH_DIR = '.trash'
const TRASH_MANIFEST = 'manifest.json'

/**
 * Vault：Markdown 文件的唯一真源。
 * 只负责文件系统操作，不了解索引/数据库的存在。
 */
export class Vault {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  abs(relPath: string): string {
    return join(this.root, relPath)
  }

  /** 绝对路径 → vault 相对 POSIX 路径 */
  rel(absPath: string): string {
    return relative(this.root, absPath).split(sep).join('/')
  }

  isInside(absPath: string): boolean {
    const r = relative(this.root, absPath)
    return r !== '' && !r.startsWith('..') && !sep.startsWith('..')
  }

  /** 递归列出所有 .md 文件（跳过点目录与附件目录） */
  async listMarkdown(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'attachments') continue
          await walk(full)
        } else if (entry.name.toLowerCase().endsWith('.md')) {
          out.push(this.rel(full))
        }
      }
    }
    await walk(this.root)
    return out.sort()
  }

  async read(relPath: string): Promise<string> {
    return readFile(this.abs(relPath), 'utf8')
  }

  async write(relPath: string, content: string): Promise<void> {
    const abs = this.abs(relPath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }

  async remove(relPath: string): Promise<void> {
    await rm(this.abs(relPath), { force: true })
  }

  async exists(relPath: string): Promise<boolean> {
    return existsSync(this.abs(relPath))
  }

  /** 根据标题生成不冲突的 vault 相对路径 */
  uniquePath(title: string): string {
    const base = slugify(title)
    let candidate = `${base}.md`
    let n = 1
    while (existsSync(this.abs(candidate))) {
      candidate = `${base}-${n}.md`
      n += 1
    }
    return candidate
  }

  /**
   * 保存笔记附件（图片等），存放在 attachments/<笔记名>/ 下。
   * 返回附件的 vault 相对路径。
   */
  async saveAttachment(noteRelPath: string, filename: string, data: Buffer): Promise<string> {
    const noteName = noteRelPath.replace(/\.md$/i, '').split('/').pop() ?? 'note'
    const ext = (extname(filename).toLowerCase() || '.png').replace(/[^.\w]/g, '')
    if (!ALLOWED_ATTACHMENT_EXT.has(ext)) {
      throw new Error(`不支持的附件类型: ${ext || '(无扩展名)'}`)
    }
    const safeStem = slugify(filename.replace(/\.[^.]+$/, '')).slice(0, 40) || 'attachment'
    const dir = join(this.root, 'attachments', noteName)
    await mkdir(dir, { recursive: true })
    let finalName = `${safeStem}${ext}`
    let n = 1
    while (existsSync(join(dir, finalName))) {
      finalName = `${safeStem}-${n}${ext}`
      n += 1
    }
    await writeFile(join(dir, finalName), data)
    return this.rel(join(dir, finalName))
  }

  /** 监听 vault 内文件/文件夹变化（不含初始扫描） */
  watch(handler: (event: VaultFileEvent) => void): { close: () => Promise<void> } {
    const watcher: FSWatcher = watch(this.root, {
      ignoreInitial: true,
      depth: 20,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    const relay = (type: VaultFileEvent['type']) => (absPath: string): void => {
      // 跳过回收站内部事件
      if (absPath.startsWith(join(this.root, TRASH_DIR))) return
      handler({ type, path: this.rel(absPath) })
    }
    watcher.on('add', relay('add'))
    watcher.on('change', relay('change'))
    watcher.on('unlink', relay('unlink'))
    watcher.on('addDir', relay('addDir'))
    watcher.on('unlinkDir', relay('unlinkDir'))
    return { close: () => watcher.close() }
  }

  async mtime(relPath: string): Promise<string> {
    const s = await stat(this.abs(relPath))
    return s.mtime.toISOString()
  }

  /** 文件字节数（不存在时抛错） */
  async size(relPath: string): Promise<number> {
    const info = await stat(this.abs(relPath))
    return info.size
  }

  // ---------- 文件操作（文件树） ----------

  /** 路径安全校验：拒绝绝对路径、.. 逃逸、空字节；返回规范化绝对路径（'' 与 '.' 表示根目录，合法） */
  private resolveSafe(relPath: string): string {
    if (relPath.includes('\0')) throw new Error('非法路径')
    if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) throw new Error('非法路径：不允许绝对路径')
    const abs = join(this.root, relPath || '.')
    const rel = relative(this.root, abs)
    // rel === '' 即根目录本身，合法；只拦截逃逸
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('非法路径：越出知识库目录')
    }
    return abs
  }

  /** 名称安全校验（单段，不含路径分隔符） */
  private safeName(name: string, fallback: string): string {
    const cleaned = name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 120)
    return cleaned || fallback
  }

  /** 构建文件树（跳过点目录与回收站，文件夹优先排序；包含全部文件类型） */
  async listTree(): Promise<TreeNode[]> {
    const build = async (dir: string): Promise<TreeNode[]> => {
      const entries = await readdir(dir, { withFileTypes: true })
      const folders: TreeNode[] = []
      const files: TreeNode[] = []
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        const rel = this.rel(full)
        if (entry.isDirectory()) {
          if (entry.name === 'attachments') continue
          folders.push({ name: entry.name, path: rel, kind: 'folder', children: await build(full) })
        } else {
          files.push({ name: entry.name, path: rel, kind: 'file' })
        }
      }
      folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      return [...folders, ...files]
    }
    return build(this.root)
  }

  /** 列出 vault 内全部文件（含 attachments，跳过回收站与点目录） */
  async listAllFiles(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          out.push(this.rel(full))
        }
      }
    }
    await walk(this.root)
    return out
  }

  /** 新建笔记（自动避让重名） */
  async createFile(relDir: string, title = '未命名'): Promise<string> {
    const dirAbs = this.resolveSafe(relDir || '.')
    const base = slugify(title)
    let candidate = `${base}.md`
    let n = 1
    while (existsSync(join(dirAbs, candidate))) {
      candidate = `${base}-${n}.md`
      n += 1
    }
    const rel = (relDir ? `${relDir.replace(/\/+$/, '')}/` : '') + candidate
    await this.write(rel, '')
    return rel
  }

  /** 新建文件夹 */
  async createDir(relDir: string, name: string): Promise<string> {
    const parentAbs = this.resolveSafe(relDir || '.')
    const safe = this.safeName(name, '新建文件夹')
    const abs = join(parentAbs, safe)
    if (existsSync(abs)) throw new Error(`已存在同名项：${safe}`)
    await mkdir(abs, { recursive: true })
    return this.rel(abs)
  }

  /** 重命名（保持同目录） */
  async renamePath(relPath: string, newName: string): Promise<string> {
    const abs = this.resolveSafe(relPath)
    if (!existsSync(abs)) throw new Error(`不存在：${relPath}`)
    const isFolder = (await stat(abs)).isDirectory()
    const safe = isFolder ? this.safeName(newName, '文件夹') : this.safeName(newName, '未命名')
    const finalName = isFolder ? safe : `${safe.replace(/\.md$/i, '')}.md`
    const targetAbs = join(dirname(abs), finalName)
    if (targetAbs === abs) return this.rel(abs)
    if (existsSync(targetAbs)) throw new Error(`已存在同名项：${finalName}`)
    await rename(abs, targetAbs)
    return this.rel(targetAbs)
  }

  /** 移动到目标文件夹（targetDir 为空表示根目录） */
  async movePath(relPath: string, targetDir: string): Promise<string> {
    const abs = this.resolveSafe(relPath)
    if (!existsSync(abs)) throw new Error(`不存在：${relPath}`)
    const dirAbs = this.resolveSafe(targetDir || '.')
    const targetAbs = join(dirAbs, basename(abs))
    if (targetAbs === abs) return this.rel(abs)
    // 禁止把文件夹移进自己或自己的子目录
    if (targetAbs.startsWith(`${abs}${sep}`)) throw new Error('不能将文件夹移入自身')
    if (existsSync(targetAbs)) throw new Error(`目标位置已存在同名项：${basename(abs)}`)
    await rename(abs, targetAbs)
    return this.rel(targetAbs)
  }

  /** 删除到回收站 */
  async deleteToTrash(relPath: string): Promise<void> {
    const abs = this.resolveSafe(relPath)
    if (!existsSync(abs)) throw new Error(`不存在：${relPath}`)
    const trashAbs = join(this.root, TRASH_DIR)
    await mkdir(trashAbs, { recursive: true })
    const stamp = Date.now()
    const trashName = `${stamp}-${basename(abs)}`
    const manifest = await this.readTrashManifest()
    manifest.push({
      name: trashName,
      originalPath: this.rel(abs),
      deletedAt: new Date(stamp).toISOString()
    })
    await rename(abs, join(trashAbs, trashName))
    await this.writeTrashManifest(manifest)
  }

  private async readTrashManifest(): Promise<TrashEntry[]> {
    try {
      const raw = await readFile(join(this.root, TRASH_DIR, TRASH_MANIFEST), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as TrashEntry[]) : []
    } catch {
      return []
    }
  }

  private async writeTrashManifest(entries: TrashEntry[]): Promise<void> {
    await writeFile(
      join(this.root, TRASH_DIR, TRASH_MANIFEST),
      JSON.stringify(entries, null, 2),
      'utf8'
    )
  }

  /** 回收站列表（新的在前） */
  async listTrash(): Promise<TrashEntry[]> {
    const manifest = await this.readTrashManifest()
    return manifest
      .filter((entry) => existsSync(join(this.root, TRASH_DIR, entry.name)))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  /** 从回收站恢复（回到原位置，若已被占用则加序号） */
  async restoreFromTrash(name: string): Promise<string> {
    const manifest = await this.readTrashManifest()
    const entry = manifest.find((e) => e.name === name)
    if (!entry) throw new Error('回收站条目不存在')
    const src = join(this.root, TRASH_DIR, name)
    if (!existsSync(src)) throw new Error('回收站文件已丢失')
    const originalAbs = this.resolveSafe(entry.originalPath)
    let target = originalAbs
    let n = 1
    while (existsSync(target)) {
      const ext = extname(originalAbs)
      const stem = originalAbs.slice(0, originalAbs.length - ext.length)
      target = `${stem}-恢复${n}${ext}`
      n += 1
    }
    await mkdir(dirname(target), { recursive: true })
    await rename(src, target)
    await this.writeTrashManifest(manifest.filter((e) => e.name !== name))
    return this.rel(target)
  }

  /** 清空回收站，返回清理数量 */
  async emptyTrash(): Promise<number> {
    const manifest = await this.readTrashManifest()
    for (const entry of manifest) {
      await rm(join(this.root, TRASH_DIR, entry.name), { recursive: true, force: true })
    }
    await this.writeTrashManifest([])
    return manifest.length
  }

  /** 清理超过 maxAgeDays 天的回收站条目 */
  async purgeOldTrash(maxAgeDays = 30): Promise<number> {
    const manifest = await this.readTrashManifest()
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000
    const stale = manifest.filter((e) => new Date(e.deletedAt).getTime() <= cutoff)
    for (const entry of stale) {
      await rm(join(this.root, TRASH_DIR, entry.name), { recursive: true, force: true })
    }
    if (stale.length > 0) {
      await this.writeTrashManifest(manifest.filter((e) => !stale.includes(e)))
    }
    return stale.length
  }

  /** 复制文件（导入用） */
  async copyFileTo(srcAbs: string, targetDir: string): Promise<string> {
    const dirAbs = this.resolveSafe(targetDir || '.')
    let target = join(dirAbs, basename(srcAbs))
    let n = 1
    while (existsSync(target)) {
      const ext = extname(srcAbs)
      const stem = basename(srcAbs).slice(0, basename(srcAbs).length - ext.length)
      target = join(dirAbs, `${stem}-${n}${ext}`)
      n += 1
    }
    await copyFile(srcAbs, target)
    return this.rel(target)
  }
}
