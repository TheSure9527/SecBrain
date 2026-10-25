import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { Vault } from '../../src/main/vault/vault'

let root: string
let vault: Vault

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'secbrain-vault-'))
  vault = new Vault(root)
  await vault.ensure()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Vault 根目录操作（回归：空 dir 曾误报越界）', () => {
  it('根目录新建文件夹', async () => {
    const path = await vault.createDir('', '新文件夹')
    expect(path).toBe('新文件夹')
    expect(existsSync(join(root, '新文件夹'))).toBe(true)
  })

  it('根目录新建笔记（去重名）', async () => {
    const first = await vault.createFile('', '测试')
    expect(first).toBe('测试.md')
    const second = await vault.createFile('', '测试')
    expect(second).toBe('测试-1.md')
    expect(await vault.read('测试.md')).toBe('')
  })

  it('子目录新建笔记路径正确', async () => {
    await vault.createDir('', '日记')
    const path = await vault.createFile('日记', '今天')
    expect(path).toBe('日记/今天.md')
    await vault.write(path, '# 今天')
    expect(await vault.read(path)).toBe('# 今天')
  })

  it('移动到根目录（targetDir 为空）', async () => {
    await vault.createDir('', '暂存')
    const file = await vault.createFile('暂存', '待移动')
    const moved = await vault.movePath(file, '')
    expect(moved).toBe('待移动.md')
    expect(existsSync(join(root, '待移动.md'))).toBe(true)
  })
})

describe('Vault 路径安全', () => {
  it('拒绝 ../ 逃逸', async () => {
    await expect(vault.createDir('../evil', 'x')).rejects.toThrow('越出知识库目录')
    await expect(vault.createFile('../evil', 'x')).rejects.toThrow()
  })

  it('拒绝绝对路径', async () => {
    await expect(vault.createDir('/etc', 'x')).rejects.toThrow('不允许绝对路径')
  })
})

describe('Vault 重命名与移动', () => {
  it('重命名文件', async () => {
    const file = await vault.createFile('', '旧名')
    const renamed = await vault.renamePath(file, '新名')
    expect(renamed).toBe('新名.md')
    expect(existsSync(join(root, '新名.md'))).toBe(true)
    expect(existsSync(join(root, '旧名.md'))).toBe(false)
  })

  it('重命名到已存在的名字报错', async () => {
    await vault.createFile('', 'A')
    await vault.createFile('', 'B')
    await expect(vault.renamePath('A.md', 'B')).rejects.toThrow('已存在同名项')
  })

  it('文件夹不能移入自身', async () => {
    const dir = await vault.createDir('', '父文件夹')
    await expect(vault.movePath(dir, dir)).rejects.toThrow('不能将文件夹移入自身')
  })
})

describe('Vault 回收站', () => {
  it('删除进回收站并可恢复', async () => {
    const file = await vault.createFile('', '可恢复')
    await vault.write(file, '内容')
    await vault.deleteToTrash(file)
    expect(existsSync(join(root, file))).toBe(false)

    const trash = await vault.listTrash()
    expect(trash).toHaveLength(1)
    expect(trash[0]!.originalPath).toBe('可恢复.md')

    const restored = await vault.restoreFromTrash(trash[0]!.name)
    expect(restored).toBe('可恢复.md')
    expect(await vault.read('可恢复.md')).toBe('内容')
    expect(await vault.listTrash()).toHaveLength(0)
  })

  it('恢复时原名被占用则加后缀', async () => {
    const file = await vault.createFile('', '冲突')
    await vault.deleteToTrash(file)
    await vault.createFile('', '冲突')
    const trash = await vault.listTrash()
    const restored = await vault.restoreFromTrash(trash[0]!.name)
    expect(restored).toBe('冲突-恢复1.md')
  })

  it('清空回收站', async () => {
    await vault.createFile('', 'A')
    await vault.createFile('', 'B')
    await vault.deleteToTrash('A.md')
    await vault.deleteToTrash('B.md')
    const count = await vault.emptyTrash()
    expect(count).toBe(2)
    expect(await vault.listTrash()).toHaveLength(0)
  })

  it('清理过期条目', async () => {
    const file = await vault.createFile('', '老的')
    await vault.deleteToTrash(file)
    const purged = await vault.purgeOldTrash(0)
    expect(purged).toBe(1)
    expect(await vault.listTrash()).toHaveLength(0)
  })
})

describe('Vault listTree', () => {
  it('包含非 md 文件（图片/PDF 等）', async () => {
    await writeFile(join(root, '图片.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(root, '文档.pdf'), 'pdf')
    const tree = await vault.listTree()
    const names = tree.map((n) => n.name)
    expect(names).toContain('图片.png')
    expect(names).toContain('文档.pdf')
  })

  it('文件夹优先 + 隐藏目录被跳过', async () => {
    await vault.createDir('', '工作')
    await vault.createDir('', '生活')
    await vault.createFile('工作', '周报')
    await vault.createFile('', '根笔记')
    await writeFile(join(root, '.hidden.md'), 'x')

    const tree = await vault.listTree()
    expect(tree.map((n) => n.name)).toEqual(['工作', '生活', '根笔记.md'])
    const work = tree.find((n) => n.name === '工作')!
    expect(work.kind).toBe('folder')
    expect(work.children?.map((c) => c.name)).toEqual(['周报.md'])
  })
})
