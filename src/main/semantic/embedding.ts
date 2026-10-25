/**
 * 本地嵌入模型（transformers.js + onnxruntime-node）。
 * 模型首次使用时下载到 userData/models，支持配置镜像源。
 */

export interface EmbeddingProvider {
  readonly model: string
  embed(texts: string[]): Promise<Float32Array[]>
}

interface ExtractorOutput {
  dims: number[]
  data: Float32Array
}

type Extractor = (
  texts: string[],
  options: Record<string, unknown>
) => Promise<ExtractorOutput>

export class BuiltinEmbeddingProvider implements EmbeddingProvider {
  private extractorPromise: Promise<Extractor> | null = null

  constructor(
    readonly model: string,
    private readonly cacheDir: string,
    private readonly mirror?: string,
    private readonly onProgress?: (percent: number) => void
  ) {}

  private async load(): Promise<Extractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const { pipeline, env } = await import('@xenova/transformers')
        env.cacheDir = this.cacheDir
        env.allowLocalModels = false
        const host = this.mirror?.trim()
        if (host) {
          env.remoteHost = host.endsWith('/') ? host : `${host}/`
        }
        // ModelScope 的默认分支是 master，HF 是 main
        const revision = /modelscope/i.test(host ?? '') ? 'master' : 'main'
        const extractor = await pipeline('feature-extraction', this.model, {
          revision,
          progress_callback: (event: { status?: string; progress?: number }) => {
            if (event.status === 'progress' && typeof event.progress === 'number') {
              this.onProgress?.(Math.round(event.progress))
            }
          }
        })
        this.onProgress?.(100)
        return extractor as unknown as Extractor
      })()
      // 失败后允许重试
      this.extractorPromise.catch(() => {
        this.extractorPromise = null
      })
    }
    return this.extractorPromise
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const extractor = await this.load()
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
      truncation: true
    })
    const dim = output.dims[1] ?? 1
    const data = output.data
    const vectors: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 1) {
      vectors.push(data.slice(i * dim, (i + 1) * dim))
    }
    return vectors
  }
}

/** 向量 ↔ BLOB 转换 */
export function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

export function bufferToVector(buffer: Uint8Array): Float32Array {
  const copy = new Uint8Array(buffer)
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4)
}

/** 余弦相似度（向量已归一化时等价于点积） */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
