/** 知识库文件树相关类型（主进程 / preload / 渲染层共用） */

/** 文件树节点 */
export interface TreeNode {
  name: string
  /** vault 相对路径（POSIX），文件夹不带尾斜杠 */
  path: string
  kind: 'file' | 'folder'
  children?: TreeNode[]
}

/** 回收站条目 */
export interface TrashEntry {
  /** 回收站内的名字（<ts>-<原名>） */
  name: string
  originalPath: string
  deletedAt: string
}
