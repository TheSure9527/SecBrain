import type { ToolDefinition } from '../provider'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_event',
    description:
      '创建日历事件。start_at/end_at 使用 ISO 8601 带时区（如 2026-10-24T15:00:00+08:00）或自然语言（如"明天下午3点"）；全天事件传日期 2026-10-24 并将 all_day 设为 true',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '事件标题' },
        start_at: { type: 'string', description: '开始时间（ISO 或自然语言）' },
        end_at: { type: 'string', description: '结束时间；缺省按 1 小时处理' },
        all_day: { type: 'boolean', description: '是否全天事件' },
        location: { type: 'string', description: '地点' },
        description: { type: 'string', description: '备注' },
        calendar_id: { type: 'string', description: '日历 id；缺省用第一个 iCloud 日历' }
      },
      required: ['title', 'start_at']
    }
  },
  {
    name: 'update_event',
    description: '修改已存在的日历事件（按 event_id）',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: '事件 id' },
        title: { type: 'string' },
        start_at: { type: 'string', description: '新的开始时间（ISO 或自然语言）' },
        end_at: { type: 'string' },
        location: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'delete_event',
    description: '删除日历事件（按 event_id）',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id']
    }
  },
  {
    name: 'query_events',
    description: '查询时间范围内的日程（ISO 或自然语言范围，如"今天"、"本周"）',
    inputSchema: {
      type: 'object',
      properties: {
        start_at: { type: 'string', description: '范围开始' },
        end_at: { type: 'string', description: '范围结束；缺省与开始相同' }
      },
      required: ['start_at']
    }
  },
  {
    name: 'create_task',
    description: '创建任务（待办）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        due_at: { type: 'string', description: '截止时间（ISO 或自然语言，可空）' },
        priority: { type: 'integer', description: '优先级 0-3' },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'complete_task',
    description: '把任务标记为已完成',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    }
  },
  {
    name: 'list_tasks',
    description: '列出任务（today/week/all/done）',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['today', 'week', 'all', 'done'] }
      }
    }
  },
  {
    name: 'convert_task_to_event',
    description: '把任务转为日历事件',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id']
    }
  },
  {
    name: 'search_notes',
    description:
      '检索知识库（Markdown 笔记 + docx/pdf/xlsx/文本等材料），返回路径、标题与内容摘录。' +
      '多个关键词用空格分隔（会自动拆词并分别检索，比整句更准）。回答关于用户个人信息的提问前必须先调用',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，多个词用空格分隔，如「学历 专业 学校」' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_note',
    description: '读取指定笔记的完整内容（超长会截断）。用于在检索到笔记后深入理解细节',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '笔记的 vault 相对路径' } },
      required: ['path']
    }
  },
  {
    name: 'related_notes',
    description: '查询与某篇笔记相关的笔记（基于双向链接：反向链接 + 出链）',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '笔记的 vault 相对路径' } },
      required: ['path']
    }
  },
  {
    name: 'get_daily_brief',
    description: '获取某天的日程与任务摘要（缺省今天）',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: '日期（ISO 或自然语言，可空）' } }
    }
  }
]
