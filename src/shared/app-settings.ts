/** 应用级设置（主题、自定义 CSS） */

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  theme: ThemeMode
  /** 用户自定义 CSS 片段 */
  customCss: string
  /** 知识库目录（空 = 默认 ~/myzsk-vault） */
  vaultRoot: string
  /** 日记目录（默认「日记」） */
  dailyDir: string
  /** 日记文件名格式（默认 YYYY-MM-DD） */
  dailyFormat: string
  /** 日记模板文件路径（vault 相对，空 = 内置模板） */
  dailyTemplate: string
  /** 是否启用语义检索（本地向量索引） */
  semanticEnabled: boolean
  /** 嵌入模型 */
  semanticModel: string
  /** 模型下载镜像（空 = 官方源） */
  semanticMirror: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  customCss: '',
  vaultRoot: '',
  dailyDir: '日记',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  semanticEnabled: false,
  semanticModel: 'Xenova/bge-base-zh-v1.5',
  semanticMirror: 'https://modelscope.cn/models/'
}
