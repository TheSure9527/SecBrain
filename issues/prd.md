# myzsk — 个人知识库 + 私人管家 PRD

> 版本：v2.0（2026-10-23 重构）
> 产品定位升级：**平替 Obsidian 的大部分核心功能，叠加自研的「私人管家」能力**。
> 本地优先、数据自有（标准 Markdown）、macOS 桌面端。

## Problem Statement

我（个人用户，macOS 主力平台）当前面临的问题：

1. **知识管理工具割裂**：Obsidian 满足知识管理，但它是闭源专有软件、同步收费、插件质量参差、配置繁琐；且它与我的日程/任务/生活上下文完全隔离——笔记里写的事不会自动进入日程，日历上的会也不会关联到相关笔记。
2. **我不想被锁定**：笔记数据必须是开放格式（Markdown），随时可以迁移；工具本身最好开源可自控。
3. **日程被动**：日程分散在 macOS/iOS 日历，工具只展示不服务；缺少一个懂我上下文的管家角色。
4. **我想要的**：一个本地优先、数据自有的桌面应用——知识管理能力对标 Obsidian（双链、图谱、日记、模板、Dataview 等），并与自研的日程同步、任务、AI 管家深度打通，形成「记录 → 关联 → 行动 → 回顾」的闭环。

## Solution

**myzsk** 是一个 macOS 桌面应用（Electron + React + TypeScript），两大板块：

### 板块一：知识库（Obsidian 平替）

以 Markdown 文件为唯一内容源（`~/myzsk-vault`，与 Obsidian 目录完全互通），实现 Obsidian 的核心体验：

- **编辑与渲染**：所见即所得的编辑/预览、Callouts、高亮、脚注、LaTeX 公式、Mermaid 图表
- **链接系统**：双向链接、反向链接面板、未链接提及、链接自动补全、重命名自动更新引用、块引用与嵌入
- **组织与导航**：文件树、标签、front-matter 属性、大纲面板、命令面板（⌘P）、快速切换器（⌘O）
- **知识发现**：关系图谱、全文搜索（FTS5，支持中文）
- **记录习惯**：日记（Daily Notes）、模板、Dataview 式元数据查询
- **个性化**：浅色/深色/跟随系统主题、自定义 CSS

### 板块二：私人管家（自研差异化）

- **日历同步**：CalDAV 协议接入 iCloud，与 macOS/iOS 系统日历双向同步；月/周日历视图；冲突检测与推荐时段；智能提醒
- **任务管理**：待办清单（今天/本周/全部）、优先级、标签、关联笔记、一键转日程
- **AI 管家**：对话式管理日程与任务（"明天下午3点提醒我给妈妈打电话"）、注入笔记+日历+任务全上下文、每日晨报、会前准备

### 技术底座

- **本地优先**：SQLite 存结构化数据（索引/事件/任务/设置），Markdown 文件存正文；数据可随时用 Obsidian 直接打开
- **安全边界**：渲染层零文件/网络权限，全部经 IPC 契约；凭证（CalDAV 密码、AI Key）经 `safeStorage` 系统钥匙串加密
- **日历能力**：CalDAV（tsdav）+ iCalendar（ical.js）+ RRULE 展开（rrule）

## User Stories

### 已实现（M1–M4）

1. As a 用户, I want 创建/编辑/删除 Markdown 笔记, so that 随时记录想法与知识
2. As a 用户, I want 全文搜索笔记（标题/正文/标签，支持中文）, so that 快速找到写过的东西
3. As a 用户, I want 标签与 front-matter, so that 按主题归类
4. As a 用户, I want `[[双向链接]]` 与 Obsidian 兼容的 Vault 目录, so that 数据不被锁定、可与 Obsidian 互操作
5. As a 用户, I want 粘贴图片自动存入附件目录, so that 图文笔记自包含
6. As a 用户, I want 接入 iCloud 日历双向同步, so that 应用与系统日历数据一致
7. As a 用户, I want 月/周日历视图与事件 CRUD, so that 一眼看清并管理安排
8. As a 用户, I want 创建事件时冲突检测与替代时段推荐, so that 日程不撞车
9. As a 用户, I want 事件与任务到期时收到系统通知, so that 不遗漏
10. As a 用户, I want 任务管理（今天/本周/全部/已完成筛选）, so that 掌握待办
11. As a 用户, I want 任务一键转为日历事件, so that 重要待办进入日程被提醒

### 知识库平替（M6–M7）

12. As a 用户, I want 文件树导航（文件夹层级、新建/重命名/移动/删除）, so that 像 Finder 一样组织笔记
13. As a 用户, I want 多 Vault 管理（新建/切换/打开已有目录）, so that 分开管理工作与个人知识
14. As a 用户, I want 输入 `[[` 时自动补全笔记名, so that 快速建立链接
15. As a 用户, I want 重命名笔记时自动更新所有指向它的链接, so that 链接不断裂
16. As a 用户, I want 反向链接面板（哪些笔记链接到当前笔记）, so that 发现知识关联
17. As a 用户, I want 未链接提及提示（正文提到笔记名但未加链接）, so that 补全潜在关联
18. As a 用户, I want 嵌入 `![[笔记]]` 与块引用 `[[笔记#^块ID]]`, so that 内容复用
19. As a 用户, I want 关系图谱（本地/全局、按标签/文件夹过滤）, so that 可视化知识网络
20. As a 用户, I want 日记（Daily Notes，一键创建当天日记、日历热图回顾）, so that 养成记录习惯
21. As a 用户, I want 模板系统（管理模板、插入时替换日期/标题变量）, so that 快速创建结构化笔记
22. As a 用户, I want Dataview 式查询（按 front-matter 属性生成表格/列表）, so that 把笔记当数据库用
23. As a 用户, I want 大纲面板（自动提取标题层级，点击跳转）, so that 长文导航
24. As a 用户, I want front-matter 属性可视化编辑, so that 不手写 YAML
25. As a 用户, I want 命令面板（⌘P）与快速切换器（⌘O）, so that 全键盘高效操作
26. As a 用户, I want Callouts/高亮/脚注/LaTeX/Mermaid 渲染, so that 表达丰富内容
27. As a 用户, I want 浅色/深色/跟随系统主题与自定义 CSS, so that 界面符合我的审美
28. As a 用户, I want 当前笔记的相关上下文（反链、提及、关联任务）集中展示, so that 一屏掌握全部关联
29. As a 用户, I want 分屏/多标签工作区, so that 对照编辑多篇笔记
30. As a 用户, I want 废纸篓与恢复, so that 误删可找回

### 私人管家增强（M5/M8）

31. As a 用户, I want 与 AI 管家对话管理日程与任务, so that 用自然语言代替填表
32. As a 用户, I want AI 结合我的笔记上下文回答（"关于X我记过什么"）, so that 它像真正的管家
33. As a 用户, I want 每日晨报（早上推送今日日程+待办+相关笔记摘要）, so that 一天有序开始
34. As a 用户, I want 会前自动准备（会议前汇总相关笔记与历史上下文）, so that 开会有备而来
35. As a 用户, I want 笔记中提到的事项被智能识别为待办建议, so that 记录即行动
36. As a 用户, I want 在托盘/菜单栏看到今日摘要, so that 不打开主窗也掌握全局
37. As a 用户, I want 全局快捷键唤起快速记录/快速提问, so that 3 秒内捕获灵感
38. As a 用户, I want 本地数据备份与恢复, so that 数据安全

## Implementation Decisions

### 模块划分

**知识库（已实现）**
1. **Vault 模块**：目录管理、文件读写、附件、chokidar 监听、Markdown 唯一真源
2. **Index 模块**：SQLite 索引（notes 表 + FTS5 trigram 全文检索）
3. **NotesService**：编排 + 外部变更同步（Obsidian 兼容）

**知识库（待建）**
4. **FileTree 模块**：文件夹树状态（增删移、排序、拖拽）、路径安全校验；重命名时扫描全库更新 `[[引用]]`（LinkGraph 协同）
5. **LinkGraph 模块**：解析全部双链/嵌入/块引用，构建引用索引（links 表：source_path → target_path）；提供反链、未链接提及（正文出现目标标题但无链接）、图谱数据（nodes + edges）
6. **Templates 模块**：模板目录（`templates/`）、变量替换（`{{date}}`、`{{title}}`、`{{time}}`）
7. **DailyNotes 模块**：按日期文件名（`YYYY-MM-DD.md`）+ 模板创建；日历热图数据（按日统计笔记/任务）
8. **Dataview 模块**：front-matter 属性索引化（存入 notes 表的 properties JSON 列）；查询 DSL（简单表达式：`FROM #tag WHERE status = "x" SORT due`）→ 表格/列表渲染
9. **MarkdownX 渲染**：marked 扩展——Callouts、`==高亮==`、脚注、KaTeX 公式、Mermaid（mermaid ESM 按需加载）
10. **Workspace 模块**：多标签 + 分屏（左右/上下）、每标签独立（笔记/图谱/日记/查询视图）
11. **CommandPalette 模块**：命令注册表（各模块注册动作）、模糊匹配、⌘P/⌘O 入口
12. **Theme 模块**：CSS 变量主题（浅/暗/系统）、自定义 CSS 片段注入

**私人管家（已实现）**
13. **Calendar Sync 引擎**：CalDAV 双向同步、ETag 冲突重试、事件 CRUD
14. **EventStore**：范围查询、RRULE 展开、提醒去重
15. **TaskStore/TaskService**：任务 CRUD、筛选、转日程
16. **Scheduler**：日程+任务到期提醒

**私人管家（待建）**
17. **AI Butler 服务**：Provider 抽象（Claude/OpenAI，function calling 统一适配）；工具集：create/update/delete/query event、create/update/complete task、search_notes、get_daily_brief；上下文注入（当日日程 + 未完成任务 + 相关笔记 top-k）；API Key 经 safeStorage 加密
18. **DailyBrief 服务**：定时（用户设定）聚合当日事件/任务/昨日日记，生成摘要推送
19. **MeetingPrep 服务**：事件开始前 N 分钟，按标题/参与人/备注检索相关笔记，推送准备卡片
20. **Trash 模块**：删除移入 `.trash/`，30 天自动清理，支持恢复

### 关键架构决策

- **链接索引与文件监听联动**：文件 add/change/unlink → 增量更新 links 表；重命名 = 删除旧链接边 + 新建 + 全库引用更新（同一事务）
- **Dataview 属性索引**：front-matter 的标量属性抽出到 `notes_properties` 表（path, key, value），查询走 SQL，避免全库解析
- **图谱性能**：节点/边全量在内存构建（个人库量级 <1 万笔记），增量更新
- **AI 工具调用边界**：LLM 只返回结构化工具调用，主进程校验后执行（同 Calendar Sync 的写回路径），失败可重试
- **Obsidian 兼容红线**：Vault 格式（front-matter 规范、`attachments/`、`templates/`）不破坏；自研数据（索引/事件/任务）全部在 SQLite，不写入 Vault
- **编辑器**：继续 CodeMirror 6（M2 已接入），预览侧扩展 marked 插件；Mermaid/KaTeX 按需懒加载

## Testing Decisions

- 只测外部行为，不测实现细节；每个深度模块可独立测试（无 Electron 环境）
- **已覆盖**：Vault/NoteIndex/NotesService、ical 往返、冲突算法、EventStore（RRULE/提醒）、TaskStore
- **待补**：
  - LinkGraph：重命名引用更新、反链、未链接提及、块引用解析
  - Templates：变量替换、模板插入
  - Dataview：查询 DSL → SQL 映射、属性索引一致性
  - FileTree：路径安全（禁止 `..`/绝对路径逃逸）、移动后链接保持
  - MarkdownX：各扩展语法渲染快照
  - AI Butler：工具 schema 校验、mock LLM 响应 → 正确执行、日期解析兜底
  - DailyBrief/MeetingPrep：聚合逻辑（给定事件/任务/笔记 → 摘要结构）

## Out of Scope

- iOS/Android 原生 App（手机端通过 DAVx5 等系统级方案接入日历）
- 完整插件系统（用内置功能覆盖高频插件场景，不做第三方插件运行时）
- Obsidian Publish / 自建同步服务器（用 iCloud Drive 或个人网盘同步 Vault 目录）
- 多人协作
- 网页剪藏（后续考虑浏览器扩展）
- Canvas 白板（M8 之后评估，优先级低于链接系统与图谱）
- 本地 LLM（AI 走云端 API，Key 本地加密）

## Further Notes — 差距分析与里程碑

### 差距分析（对照 Obsidian 核心功能）

| Obsidian 功能 | 状态 | 所属模块 |
|---|---|---|
| Markdown 编辑 + 实时预览 | ✅ 已有 | M2 |
| 全文搜索 | ✅ 已有（FTS5 中文） | M2 |
| 标签 / front-matter | ✅ 部分（属性编辑器待建） | M2 / M7 |
| 双链渲染 | ✅ 部分（补全见下） | M2 / M6 |
| Vault（Obsidian 兼容） | ✅ 已有 | M2 |
| 附件管理 | ✅ 已有 | M2 |
| 文件树导航 | ❌ 缺失 | M6 FileTree |
| 多 Vault | ❌ 缺失 | M6 Vault 管理 |
| 反向链接 / 未链接提及 | ❌ 缺失 | M6 LinkGraph |
| 链接自动补全 / 重命名联动 | ❌ 缺失 | M6 LinkGraph |
| 块引用 / 嵌入 | ❌ 缺失 | M6 LinkGraph |
| 关系图谱 | ❌ 缺失 | M7 Graph |
| 日记 Daily Notes | ❌ 缺失 | M7 DailyNotes |
| 模板 | ❌ 缺失 | M7 Templates |
| Dataview 查询 | ❌ 缺失 | M7 Dataview |
| 大纲面板 | ❌ 缺失 | M7 Outline |
| 命令面板 / 快速切换 | ❌ 缺失 | M6 CommandPalette |
| Callouts/高亮/脚注/LaTeX/Mermaid | ❌ 缺失 | M7 MarkdownX |
| 主题 / 自定义 CSS | ❌ 缺失 | M6 Theme |
| 分屏 / 多标签 | ❌ 缺失 | M7 Workspace |
| 废纸篿 | ❌ 缺失 | M8 Trash |
| 插件生态 | ⛔ 不做（内置覆盖） | — |
| 官方同步 | ⛔ 不做（iCloud Drive 替代） | — |
| **日历双向同步（iCloud）** | ✅ 已有 | **M3 自研** |
| **任务 + 转日程** | ✅ 已有 | **M4 自研** |
| **冲突检测 / 智能提醒** | ✅ 已有 | **M3/M4 自研** |
| **AI 管家** | ❌ 缺失 | **M5 自研** |
| **每日晨报 / 会前准备** | ❌ 缺失 | **M8 自研** |

### 里程碑规划

- [x] **M1 骨架**：工程、IPC 契约
- [x] **M2 知识库核心**：Vault、编辑器、搜索、标签、双链渲染
- [x] **M3 日程**：CalDAV 同步、日历视图、事件 CRUD、冲突检测、提醒
- [x] **M4 任务**：任务管理、转日程、到期提醒
- [ ] **M5 AI 管家**：对话界面、自然语言管理日程/任务、上下文注入、多 Provider
- [ ] **M6 知识库平替核心**：文件树、LinkGraph（反链/补全/重命名联动）、命令面板/快速切换、主题系统、多 Vault
- [ ] **M7 知识库进阶**：日记、模板、Dataview、图谱、MarkdownX 渲染、大纲、属性编辑、分屏工作区
- [ ] **M8 管家增强与打磨**：每日晨报、会前准备、废纸篓、托盘/全局快捷键、备份、Canvas 评估

### 优先级建议（若资源有限）

必做（构成「平替大部分功能」的底线）：**M6 全部 + M7 的日记/模板/MarkdownX/图谱**；Dataview 与分屏可延后；Canvas 可不做。
