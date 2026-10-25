/** 语义检索域出口 */
export { SemanticService } from './semantic-service'
export type { ProviderFactory } from './semantic-service'
export { BuiltinEmbeddingProvider, cosineSimilarity, vectorToBuffer, bufferToVector } from './embedding'
export type { EmbeddingProvider } from './embedding'
export { chunkMarkdown, excerpt } from './chunker'
export type { Chunk } from './chunker'
