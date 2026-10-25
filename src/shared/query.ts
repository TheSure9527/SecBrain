/** Dataview 式查询共享类型 */

export interface QueryResult {
  columns: string[]
  rows: Array<Record<string, string>>
  error?: string
}

export interface QueryApi {
  run(text: string): Promise<QueryResult>
}
