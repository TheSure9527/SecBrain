import { DatabaseSync } from 'node:sqlite'
import { applySchema } from './schema'

/**
 * 打开（必要时创建）应用数据库并执行迁移。
 * 使用 WAL 模式：渲染层读、主进程写不会互相阻塞。
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applySchema(db)
  return db
}
