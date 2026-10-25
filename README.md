# myzsk — 个人知识库 + 私人管家

本地优先的 macOS 桌面应用：Markdown 知识库（Obsidian 兼容）+ iCloud 日历双向同步 + AI 管家（自然语言管理日程、冲突检测、智能提醒）。

## 隐私说明

本项目**不含任何个人数据**，可安全公开：

- 笔记正文、日历、提醒、任务全部存放在本机
  `~/Library/Application Support/SecBrain/myzsk.db`，不入库
- API Key 经系统钥匙串加密后仅存本地，代码里没有明文密钥
- 语义索引模型缓存（`models/`）与导出的 `.ics` 不进版本库
- 评测集：仓库内只有脱敏示例 `tests/eval/questions.example.json`；
  真实题集建议放在 `tests/eval/questions.local.json`（已被 `.gitignore` 忽略）

## 快速开始

```bash
npm install
npm run dev      # 开发模式（Vite HMR + Electron）
npm run build    # 构建到 out/
npm run typecheck
```

## 架构

```
src/
├── main/          # Electron 主进程（窗口、托盘、IPC handlers、业务实现）
├── preload/       # contextBridge 安全桥
├── renderer/      # React UI（笔记/日历/任务/管家/设置）
└── shared/        # 主进程与渲染层共享的 IPC 契约与类型
```

- **本地优先**：SQLite 存结构化数据，Markdown 文件存笔记正文（`~/myzsk-vault`，可直接用 Obsidian 打开）。
- **日历同步**：CalDAV 协议接入 iCloud（需 App 专用密码），与 macOS/iOS 系统日历双向同步。
- **AI 管家**：Claude / OpenAI API，function calling 执行日程操作；API Key 经 `safeStorage` 加密存储。
- **安全边界**：渲染层零文件/网络权限，所有系统能力经 IPC 契约调用。

## 里程碑

产品定位：**平替 Obsidian 大部分核心功能 + 自研私人管家**。完整需求与差距分析见 [issues/prd.md](issues/prd.md)。

- [x] **M1 骨架**：工程跑通、IPC 打通
- [x] **M2 知识库核心**：Vault + 编辑器 + 搜索 + 标签 + 双链渲染
- [x] **M3 日程**：CalDAV 同步 + 日历视图 + 事件 CRUD + 冲突检测 + 提醒
- [x] **M4 任务**：任务管理 + 任务转日程 + 到期提醒
- [x] **M5 AI 管家**：对话 + 自然语言管理日程/任务 + 上下文注入 + 多 Provider
- [x] **M6 知识库平替核心**：
  - [x] 文件树（新建/重命名/移动/拖拽/回收站）
  - [x] 命令面板 ⌘P + 快速切换器 ⌘O + 视图快捷键 ⌘1-5
  - [x] 主题系统（浅色/深色/跟随系统 + 自定义 CSS）
  - [x] 链接系统：`[[` 自动补全 / 反向链接 / 未链接提及 / 重命名联动 / 关系图谱
  - [x] 多 Vault（选择任意本地文件夹，索引重建）
  - [x] 内置文件查看器（图片缩放 / PDF / 音视频）+ 全文件类型文件树
- [ ] **M7 知识库进阶**（进行中）：
  - [x] M7-1 渲染增强：Callouts / 高亮 / 脚注 / KaTeX 公式 / Mermaid 图表
  - [x] M7-2 模板变量 + 日记（⌘D、热图、最近日记）
  - [x] M7-3 Dataview 式查询（front-matter 属性索引 + ```query 表格）
  - [x] M7-4 大纲面板（点击跳转）+ front-matter 属性编辑器
- [ ] **M8 管家增强与打磨**（进行中）：
  - [x] M8-1 检索增强：`search_notes` 返回摘录、`read_note`、`related_notes`、回答引用来源与引用卡片
  - [x] M8-1 语义索引：本地 bge-base-zh-v1.5 向量检索 + FTS/向量 RRF 融合（设置页可开关）
  - [x] M8-1 材料索引：docx / pdf / xlsx / txt / csv / 代码文件正文提取与检索（管家可读）
  - [ ] 每日晨报 + 会前准备 + 托盘/全局快捷键 + 备份

## 钉钉单聊渠道

- 渠道适配层（`channel/`）：协议转换 / @ 清洗 / 幂等去重 / 快速 ACK / sessionWebhook 回推
- 会话隔离：`channel:conversationId:userId`，桌面与各渠道历史互不串联
- 访问控制：6 位一次性绑定码 + 已绑定用户白名单（防止机器人被拉群后泄露私人内容）
- 队列：按会话分桶，同会话串行、不同会话并行

配置：设置 → 钉钉机器人（ClientID / ClientSecret，Stream 模式，无需公网 IP）。

## 架构分层

```
⓪ channel/     渠道适配：协议转换 / 验签 / 幂等 / 快速 ACK（不含业务判断）
① renderer/    表现层：只经 preload 契约访问主进程
② 应用层        notes-service / calendar-service / task-service / daily-service / query-executor / semantic-service / document-index
③ 智能体层      ai/butler-service · ai/tools（schema + executors）· provider
④ 领域层        domain/(time,ids,datetime) · link-graph · props · conflict · chunker · query-parser · ai/search · ai/retrieval
⑤ 基础设施      vault/(vault,note-file,note-index) · event-store · task-store · ical · caldav-client · embedding · doc-extract · db · settings
```

依赖规则：只能自上而下；领域层零 IO；智能体层只调应用层用例。

**索引一致性**：全文/属性/链接/向量四类索引统一由 `indexing/IndexCoordinator` 扇出，
单个 provider 失败不阻断其余但必须记录（`IndexPartialFailure`）。

**可执行校验**：

```bash
npm run check:layers   # 层级越界 / 跨域深层导入 / 循环依赖
npm run verify         # 分层 + 类型 + 全量测试
```

需求细节见 [issues/prd.md](issues/prd.md)。
