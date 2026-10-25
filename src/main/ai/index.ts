/** 智能体层出口 */
export { ButlerService } from './butler-service'
export { TOOL_DEFINITIONS, executeTool } from './tools'
export type { ToolServices, ToolExecution, NoteReference } from './tools'
export { createProvider } from './provider'
export type { AiProvider, ChatTurn, ToolCall, ToolDefinition } from './provider'
export { rrfMerge, stripHighlight } from './search'
export { extractSearchTerms, buildKnowledgeOverview } from './retrieval'
