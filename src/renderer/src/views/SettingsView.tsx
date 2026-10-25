import { useCallback, useEffect, useState } from 'react'
import {
  AI_PRESETS,
  CLAUDE_MODELS,
  api,
  calendarApi,
  type AiConfigView,
  type CalendarAccountStatus,
  type CalendarSettings,
  type DocumentStatus,
  type SemanticStatus
} from '../api'
import { SEMANTIC_MODELS } from '../../../shared/semantic'
import { useAppSettings } from '../hooks/useAppSettings'

export function SettingsView(): React.JSX.Element {
  const [status, setStatus] = useState<CalendarAccountStatus | null>(null)
  const [settings, setSettings] = useState<CalendarSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('https://caldav.icloud.com')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [vaultPath, setVaultPath] = useState('')

  // 外观（主题 / 自定义 CSS）
  const { settings: appSettings, update: updateAppSettings } = useAppSettings()
  const [customCss, setCustomCss] = useState('')
  const themeMode = appSettings.theme

  // 日记配置
  const [dailyDir, setDailyDir] = useState('日记')
  const [dailyFormat, setDailyFormat] = useState('YYYY-MM-DD')
  const [dailyTemplate, setDailyTemplate] = useState('')

  // 语义检索
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus | null>(null)
  const [semanticBusy, setSemanticBusy] = useState(false)
  const [semanticMirror, setSemanticMirror] = useState('')

  // 材料索引
  const [docsStatus, setDocsStatus] = useState<DocumentStatus | null>(null)
  const [docsBusy, setDocsBusy] = useState(false)

  useEffect(() => {
    void api.docs.status().then(setDocsStatus)
  }, [])

  useEffect(() => {
    if (!docsStatus?.indexing) return
    const timer = setInterval(() => {
      void api.docs.status().then(setDocsStatus)
    }, 2000)
    return () => clearInterval(timer)
  }, [docsStatus?.indexing])

  useEffect(() => {
    setSemanticMirror(appSettings.semanticMirror)
  }, [appSettings.semanticMirror])

  useEffect(() => {
    void api.semantic.status().then(setSemanticStatus)
  }, [])

  // 索引 / 模型下载过程中轮询状态
  useEffect(() => {
    if (!semanticStatus?.updating && semanticStatus?.downloadPercent === null) return
    const timer = setInterval(() => {
      void api.semantic.status().then(setSemanticStatus)
    }, 2000)
    return () => clearInterval(timer)
  }, [semanticStatus?.updating, semanticStatus?.downloadPercent])

  useEffect(() => {
    setCustomCss(appSettings.customCss)
    setDailyDir(appSettings.dailyDir)
    setDailyFormat(appSettings.dailyFormat)
    setDailyTemplate(appSettings.dailyTemplate)
  }, [appSettings.customCss, appSettings.dailyDir, appSettings.dailyFormat, appSettings.dailyTemplate])

  // AI 管家配置
  const [aiConfig, setAiConfig] = useState<AiConfigView | null>(null)
  const [aiProvider, setAiProvider] = useState<'claude' | 'openai'>('claude')
  const [aiModel, setAiModel] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiPresetId, setAiPresetId] = useState('deepseek')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiTouchedPreset, setAiTouchedPreset] = useState(false)
  const [aiModelCustom, setAiModelCustom] = useState(false)
  /** 从服务商 /models 接口拉到的最新列表（优先于内置预设） */
  const [liveModels, setLiveModels] = useState<string[]>([])
  /** 本地服务（Ollama/LM Studio）不需要 API Key */
  const isLocalBaseUrl = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/i.test(
    aiBaseUrl.trim()
  )
  const [modelBusy, setModelBusy] = useState(false)
  /** 本地模型探测过程与结果（直接显示在按钮下方，避免"点了没反应"） */
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<{
    ok: boolean
    lines: string[]
  } | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)

  // 切换服务商时清空实时列表，避免串用
  useEffect(() => {
    setLiveModels([])
    setModelError(null)
  }, [aiPresetId, aiBaseUrl, aiProvider])

  // 当前服务下的可选模型列表（Claude 走协议自带列表）
  const presetModels =
    aiProvider === 'claude'
      ? CLAUDE_MODELS
      : (AI_PRESETS.find((p) => p.id === aiPresetId)?.models ?? [])
  // 有实时列表就优先用（会随服务商升级自动更新），否则退回内置预设
  const modelOptions =
    liveModels.length > 0
      ? [...new Set([...(aiModel ? [aiModel] : []), ...liveModels])]
      : presetModels

  const refresh = useCallback(async () => {
    const [accountStatus, calendarSettings, ai] = await Promise.all([
      calendarApi.getAccountStatus(),
      calendarApi.getSettings(),
      api.butler.getConfig()
    ])
    setStatus(accountStatus)
    setSettings(calendarSettings)
    setAiConfig(ai)
    setAiProvider(ai.provider)
    setAiModel(ai.model)
    if (ai.provider === 'openai') {
      setAiBaseUrl(ai.baseUrl)
      // 反查预设（匹配不到则为自定义）
      const matched = AI_PRESETS.find((p) => p.baseUrl === ai.baseUrl)
      setAiPresetId(matched?.id ?? 'custom')
      setAiModelCustom(!matched || !matched.models.includes(ai.model))
    } else {
      setAiModelCustom(!CLAUDE_MODELS.includes(ai.model))
    }
    if (accountStatus.serverUrl) setServerUrl(accountStatus.serverUrl)
    if (accountStatus.username) setUsername(accountStatus.username)
  }, [])

  useEffect(() => {
    void refresh()
    void api.getVaultPath().then(setVaultPath)
  }, [refresh])

  const handleConnect = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await calendarApi.connectAccount({ serverUrl, username, password })
      setStatus(next)
      setPassword('')
      setMessage(
        next.status === 'error'
          ? `连接失败：${next.error ?? '未知错误'}`
          : `已连接，同步到 ${next.calendarCount} 个日历`
      )
    } catch (err) {
      setMessage(`连接失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await calendarApi.disconnectAccount()
      setStatus(next)
      setMessage('已断开连接')
    } finally {
      setBusy(false)
    }
  }

  const handleSync = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await calendarApi.syncNow()
      setStatus(next)
      setMessage(next.error ? `同步失败：${next.error}` : '同步完成')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveSettings = async (): Promise<void> => {
    if (!settings) return
    setBusy(true)
    try {
      setSettings(await calendarApi.saveSettings(settings))
      setMessage('偏好已保存')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-view">
      <h1>设置</h1>

      <section className="settings-section">
        <h2>日历账号（CalDAV）</h2>
        <p className="settings-hint">
          接入 iCloud 日历：需要在 Apple ID 账户页生成「App 专用密码」，此处填写 Apple ID 邮箱与专用密码。
          凭证经系统钥匙串加密后仅存储在本地。
        </p>
        <div className="settings-grid">
          <label className="field">
            <span>服务器地址</span>
            <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          </label>
          <label className="field">
            <span>用户名（Apple ID）</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="name@example.com"
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>App 专用密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              autoComplete="current-password"
            />
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="btn-primary"
            disabled={busy || !username || !password}
            onClick={() => void handleConnect()}
          >
            {status?.status === 'connected' ? '重新连接' : '连接'}
          </button>
          {status?.status === 'connected' && (
            <>
              <button className="btn-ghost" disabled={busy} onClick={() => void handleSync()}>
                立即同步
              </button>
              <button className="btn-danger" disabled={busy} onClick={() => void handleDisconnect()}>
                断开连接
              </button>
            </>
          )}
        </div>
        {status && (
          <div className="settings-status">
            状态：
            <span className={`sync-badge ${status.status}`}>
              {status.status === 'connected'
                ? `已连接 · ${status.calendarCount} 个日历`
                : status.status === 'error'
                  ? '异常'
                  : '未连接'}
            </span>
            {status.lastSyncAt && (
              <span className="settings-last-sync">
                上次同步：{new Date(status.lastSyncAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>多设备同步</h2>
        <p className="settings-hint">
          在应用中选择 <b>☁️ iCloud 日历</b>（非 📱 本地日历）创建的事件，会自动推送到 iCloud：
        </p>
        <div className="settings-actions">
          <button
            className="btn-ghost"
            onClick={() =>
              void (async () => {
                setMessage(null)
                try {
                  const calendars = await calendarApi.listCalendars()
                  const cloud = calendars.find((cal) => cal.source === 'caldav')
                  if (!cloud) {
                    setMessage('没有云端日历可写入，请先在下方连接 iCloud')
                    return
                  }
                  const start = new Date(Date.now() + 5 * 60 * 1000)
                  const end = new Date(start.getTime() + 30 * 60 * 1000)
                  await calendarApi.createEvent({
                    calendarId: cloud.id,
                    title: 'SecBrain 同步测试',
                    description: '这条事件用于验证 iCloud → 手机日历的同步链路，可随时删除。',
                    startAt: start.toISOString(),
                    endAt: end.toISOString(),
                    allDay: false
                  })
                  setMessage(
                    `已在「${cloud.displayName}」创建测试事件（5 分钟后），请到手机日历查看`
                  )
                } catch (err) {
                  setMessage(`测试失败：${err instanceof Error ? err.message : String(err)}`)
                }
              })()
            }
          >
            测试同步（创建 5 分钟后的日程）
          </button>
        </div>
        <ul className="settings-hint settings-list">
          <li>
            <b>Mac</b>：无需设置。系统「日历」App 绑定同一 Apple ID 即自动显示，双向同步。
          </li>
          <li>
            <b>华为 / 安卓手机</b>：安装 CalDAV 同步工具 <b>DAVx5</b>（F-Droid 免费 / 应用市场约 ¥15），
            添加账号时服务器填 <code>https://caldav.icloud.com</code>，用户名填 Apple ID 邮箱，
            密码填 App 专用密码。同步后事件即出现在手机自带日历 App 中，双向同步。
          </li>
          <li>
            <b>鸿蒙 NEXT（5.0+ / 6.x）</b>：系统日历可直接添加 CalDAV 账户（实测可用）。
            路径：日历 → 右上角 <b>⋮</b> → 设置 → 账户 → 添加账户 → <b>CalDAV / 其他账户</b>，
            服务器填 <code>https://caldav.icloud.com</code>，用户名填 Apple ID 邮箱，
            密码填 <b>App 专用密码</b>（Apple ID → 登录与安全 → App 专用密码）。同步后日程出现在系统日历中。
          </li>
          <li>
            <b>已知限制（华为日历）</b>：只同步 <b>VEVENT（日程）</b>，
            <b>VTODO（提醒事项）不显示</b>；「本地日历」里的事件也不会出现在手机上——
            建事件时请选择带 ☁️ 的日历。
          </li>
        </ul>
      </section>

      <section className="settings-section">
        <h2>AI 管家</h2>
        <p className="settings-hint">
          配置大模型后可自然语言管理日程与任务；<strong>未配置时管家自动使用本地规则模式</strong>
          （离线可用：日程 / 待办 / 记笔记 / 知识库检索）。Key 经系统钥匙串加密，仅存本地。
          支持 Claude 与任意 OpenAI 兼容服务（DeepSeek、千问、Kimi、GLM、Gemini），
          也可点「检测本地模型」接入本机 Ollama / LM Studio（无需 Key）。
        </p>
        {aiConfig && (
          <>
            <div className="settings-grid">
              <label className="field">
                <span>协议</span>
                <select
                  value={aiProvider}
                  onChange={(e) => {
                    const provider = e.target.value as 'claude' | 'openai'
                    setAiProvider(provider)
                    setAiModelCustom(false)
                    if (provider === 'claude') {
                      setAiModel(CLAUDE_MODELS[0]!)
                    } else {
                      const preset = AI_PRESETS.find((p) => p.id === aiPresetId) ?? AI_PRESETS[0]!
                      setAiModel(preset.model)
                    }
                  }}
                >
                  <option value="claude">Claude（Anthropic 原生）</option>
                  <option value="openai">OpenAI 兼容（DeepSeek 等）</option>
                </select>
              </label>
              <label className="field">
                <span>模型</span>
                {modelOptions.length > 0 && !aiModelCustom ? (
                  <select
                    value={modelOptions.includes(aiModel) ? aiModel : '__custom'}
                    onChange={(e) => {
                      if (e.target.value === '__custom') {
                        setAiModelCustom(true)
                        setAiTouchedPreset(true)
                      } else {
                        setAiModel(e.target.value)
                      }
                    }}
                  >
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value="__custom">自定义模型…</option>
                  </select>
                ) : (
                  <input
                    value={aiModel}
                    onChange={(e) => {
                      setAiModel(e.target.value)
                      setAiTouchedPreset(true)
                    }}
                    placeholder="输入模型名，如 deepseek-chat"
                  />
                )}
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={modelBusy}
                  title="用当前 Key 调用 /models 拉取服务端真实可用模型"
                  onClick={() =>
                    void (async () => {
                      setModelBusy(true)
                      setModelError(null)
                      try {
                        const result = await api.butler.listModels()
                        if (result.error) {
                          setModelError(result.error)
                          return
                        }
                        setLiveModels(result.models)
                        if (result.models.length > 0 && !result.models.includes(aiModel)) {
                          setAiModel(result.models[0]!)
                          setAiModelCustom(false)
                        }
                      } finally {
                        setModelBusy(false)
                      }
                    })()
                  }
                >
                  {modelBusy ? '读取中…' : '刷新模型列表'}
                </button>
                {modelError && <span className="field-hint">{modelError}</span>}
                {liveModels.length > 0 && (
                  <span className="field-hint">已从服务商读取 {liveModels.length} 个可用模型</span>
                )}
              </label>
            </div>

            {aiProvider === 'openai' && (
              <>
                <label className="field">
                  <span>服务</span>
                  <select
                    value={aiPresetId}
                    onChange={(e) => {
                      const presetId = e.target.value
                      setAiPresetId(presetId)
                      setAiTouchedPreset(false)
                      setAiModelCustom(false)
                      const preset = AI_PRESETS.find((p) => p.id === presetId)
                      if (preset) {
                        // 切换服务：Base URL 与模型列表同步切换
                        setAiBaseUrl(preset.baseUrl)
                        setAiModel(preset.model)
                      } else {
                        // 自定义：保留当前 baseUrl 供编辑
                        setAiBaseUrl((prev) => prev || '')
                      }
                    }}
                  >
                    {AI_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">自定义（自建网关等）</option>
                  </select>
                </label>
                <label className="field">
                  <span>Base URL</span>
                  <input
                    value={aiBaseUrl}
                    onChange={(e) => {
                      setAiBaseUrl(e.target.value)
                      setAiPresetId('custom')
                      setAiTouchedPreset(true)
                    }}
                    placeholder="https://api.deepseek.com"
                  />
                </label>
              </>
            )}

            <label className="field">
              <span>API Key{aiConfig.hasKey ? '（已保存，留空则保持不变）' : ''}</span>
              <input
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={aiConfig.hasKey ? '••••••••（已保存）' : 'sk-...'}
                autoComplete="off"
              />
              {aiConfig.keyError && <span className="field-hint error">{aiConfig.keyError}</span>}
            </label>
            <div className="settings-actions">
              <button
                className="btn-ghost"
                disabled={probing}
                title="自动检测本机的 Ollama / LM Studio / llama.cpp"
                onClick={() =>
                  void (async () => {
                    setProbing(true)
                    setProbeResult({ ok: false, lines: ['正在探测 11434 / 1234 / 8080 …'] })
                    try {
                      const found = await api.butler.probeLocal()
                      const attempts = (found.attempts ?? []).map(
                        (item) => `${item.name} ${item.url} → ${item.error ?? '可用'}`
                      )
                      if (found.found) {
                        setAiProvider('openai')
                        setAiPresetId('custom')
                        setAiBaseUrl(found.baseUrl ?? '')
                        if (found.models[0]) setAiModel(found.models[0])
                        setLiveModels(found.models)
                        setProbeResult({
                          ok: true,
                          lines: [`已发现 ${found.name}，${found.models.length} 个模型，点「保存配置」生效`]
                        })
                      } else {
                        setProbeResult({
                          ok: false,
                          lines: [
                            '未检测到本地模型服务',
                            ...attempts,
                            '如需本地模型：brew install ollama && ollama serve',
                            '然后：ollama pull qwen2.5:7b（约 4.7GB）'
                          ]
                        })
                      }
                    } catch (err) {
                      setProbeResult({
                        ok: false,
                        lines: [`探测失败：${err instanceof Error ? err.message : String(err)}`]
                      })
                    } finally {
                      setProbing(false)
                    }
                  })()
                }
              >
                {probing ? '探测中…' : '检测本地模型'}
              </button>
              {probeResult && (
                <div className={`probe-result ${probeResult.ok ? 'ok' : 'fail'}`}>
                  {probeResult.lines.map((line, index) => (
                    <div key={index} className={index === 0 ? 'probe-title' : 'probe-line'}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
              <button
                className="btn-primary"
                disabled={
                  busy ||
                  !aiModel.trim() ||
                  (!isLocalBaseUrl && !aiKey.trim() && !aiConfig.hasKey) ||
                  (aiProvider === 'openai' && !aiBaseUrl.trim())
                }
                onClick={() =>
                  void (async () => {
                    setBusy(true)
                    setMessage(null)
                    try {
                      const next = await api.butler.saveConfig({
                        provider: aiProvider,
                        model: aiModel.trim(),
                        apiKey: aiKey.trim(),
                        baseUrl: aiProvider === 'openai' ? aiBaseUrl.trim() : undefined
                      })
                      setAiConfig(next)
                      setAiKey('')
                      setMessage('AI 配置已保存')
                    } catch (err) {
                      setMessage(`保存失败：${err instanceof Error ? err.message : String(err)}`)
                    } finally {
                      setBusy(false)
                    }
                  })()
                }
              >
                保存配置
              </button>
              {aiConfig.hasKey && (
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      setBusy(true)
                      setMessage(null)
                      try {
                        const result = await api.butler.testConnection()
                        setMessage(result.ok ? '连接成功，管家已就绪' : `连接失败：${result.error ?? '未知错误'}`)
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }
                >
                  测试连接
                </button>
              )}
            </div>
            {aiConfig.hasKey && (
              <div className="settings-status">
                状态：<span className="sync-badge connected">已配置</span>
                <span className="settings-last-sync">
                  {aiConfig.provider === 'openai'
                    ? `${new URL(aiConfig.baseUrl).host} / ${aiConfig.model}`
                    : `Claude / ${aiConfig.model}`}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      <section className="settings-section">
        <h2>管家偏好</h2>
        {settings && (
          <>
            <div className="settings-grid">
              <label className="field">
                <span>默认提醒</span>
                <select
                  value={String(settings.defaultReminderMinutes)}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultReminderMinutes: Number(e.target.value)
                    })
                  }
                >
                  <option value="0">不提醒</option>
                  <option value="5">提前 5 分钟</option>
                  <option value="15">提前 15 分钟</option>
                  <option value="30">提前 30 分钟</option>
                  <option value="60">提前 1 小时</option>
                </select>
              </label>
              <label className="field">
                <span>事件缓冲（分钟）</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={settings.bufferMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, bufferMinutes: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>工作时段起</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={settings.workStartHour}
                  onChange={(e) =>
                    setSettings({ ...settings, workStartHour: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>工作时段止</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={settings.workEndHour}
                  onChange={(e) =>
                    setSettings({ ...settings, workEndHour: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="settings-actions">
              <button className="btn-primary" disabled={busy} onClick={() => void handleSaveSettings()}>
                保存偏好
              </button>
            </div>
            <p className="settings-hint">
              缓冲与工作时段用于「冲突推荐时段」的计算。
            </p>
          </>
        )}
      </section>

      <section className="settings-section">
        <h2>外观</h2>
        <div className="settings-grid">
          <label className="field">
            <span>主题</span>
            <select
              value={themeMode}
              onChange={(e) => void updateAppSettings({ theme: e.target.value as 'light' | 'dark' | 'system' })}
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>自定义 CSS（注入到应用，可覆盖任意样式）</span>
          <textarea
            rows={5}
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            onBlur={() => void updateAppSettings({ customCss })}
            placeholder={'例如：\n:root {\n  --accent: #e35d6a;\n}'}
          />
        </label>
        <p className="settings-hint">修改即时生效，自动保存。</p>
      </section>

      <section className="settings-section">
        <h2>材料索引（docx / pdf / excel）</h2>
        <p className="settings-hint">
          除了 Markdown 笔记，应用还会提取 Word（.docx）、PDF、Excel（.xlsx/.xls）以及
          txt/csv/文本类文件的正文并建立索引，管家可以检索并阅读这些材料（如简历、合同、报表）。
          扫描在后台自动进行，文件改动会自动更新。
        </p>
        <div className="settings-actions">
          <button
            className="btn-ghost"
            disabled={docsStatus?.indexing}
            onClick={() =>
              void (async () => {
                setDocsBusy(true)
                try {
                  setDocsStatus(await api.docs.rebuild())
                } finally {
                  setDocsBusy(false)
                }
              })()
            }
          >
            {docsStatus?.indexing || docsBusy ? '索引中…' : '重新扫描材料'}
          </button>
          <span className="settings-last-sync">
            已索引 {docsStatus?.count ?? 0} 个文档
            {docsStatus?.lastIndexedAt
              ? ` · 上次扫描 ${new Date(docsStatus.lastIndexedAt).toLocaleString('zh-CN')}`
              : ''}
          </span>
        </div>
        {docsStatus && docsStatus.issues.length > 0 && (
          <div className="docs-issues">
            <div className="docs-issues-title">
              以下 {docsStatus.issues.length} 个文件未能读取内容：
            </div>
            <ul>
              {docsStatus.issues.map((issue) => (
                <li key={issue.path}>
                  <span className="docs-issue-path" title={issue.path}>
                    {issue.path}
                  </span>
                  <span className="docs-issue-reason">{issue.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="settings-hint">
          暂不支持：图片 OCR（扫描件无文字层）、pages/numbers/key（Apple iWork）。
          这些文件仍可打开查看，只是不参与检索。
        </p>
      </section>

      <section className="settings-section">
        <h2>语义检索（本地向量索引）</h2>
        <p className="settings-hint">
          用本地嵌入模型为笔记建立向量索引，让管家能按语义检索（而不只是关键词）。模型
          <code>{semanticStatus?.model ?? 'bge-base-zh-v1.5'}</code>
          首次启用时自动下载（约 400MB），全部在本机运行，笔记内容不上传。
        </p>
        <label className="field">
          <span>嵌入模型</span>
          <select
            value={semanticStatus?.model ?? appSettings.semanticModel}
            disabled={semanticBusy}
            onChange={(e) =>
              void (async () => {
                setSemanticBusy(true)
                try {
                  const next = await api.semantic.setModel(e.target.value)
                  setSemanticStatus(next)
                  // 切换模型后旧向量已清空，若已启用则重新建索引
                  if (next.enabled) {
                    void api.semantic.rebuild().then(setSemanticStatus)
                  }
                } finally {
                  setSemanticBusy(false)
                }
              })()
            }
          >
            {SEMANTIC_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-actions">
          <button
            className="btn-primary"
            disabled={semanticBusy}
            onClick={() =>
              void (async () => {
                setSemanticBusy(true)
                try {
                  const next = semanticStatus?.enabled
                    ? await api.semantic.setEnabled(false)
                    : await api.semantic.setEnabled(true)
                  setSemanticStatus(next)
                } finally {
                  setSemanticBusy(false)
                }
              })()
            }
          >
            {semanticStatus?.enabled ? '停用' : '启用并建索引'}
          </button>
          {semanticStatus?.enabled && (
            <button
              className="btn-ghost"
              disabled={semanticBusy || semanticStatus.updating}
              onClick={() =>
                void (async () => {
                  setSemanticBusy(true)
                  try {
                    setSemanticStatus(await api.semantic.rebuild())
                  } finally {
                    setSemanticBusy(false)
                  }
                })()
              }
            >
              {semanticStatus.updating ? '索引中…' : '重建索引'}
            </button>
          )}
        </div>
        {semanticStatus && (
          <div className="settings-status">
            状态：
            <span
              className={`sync-badge ${
                semanticStatus.error ? 'error' : semanticStatus.enabled ? 'connected' : ''
              }`}
            >
              {semanticStatus.error
                ? '出错'
                : semanticStatus.downloadPercent !== null
                  ? `下载模型中 ${semanticStatus.downloadPercent}%`
                  : semanticStatus.updating
                    ? '索引中'
                    : semanticStatus.enabled
                      ? semanticStatus.indexedChunks > 0
                        ? '已就绪'
                        : '待建索引'
                      : '未启用'}
            </span>
            <span className="settings-last-sync">
              {semanticStatus.indexedNotes} 篇笔记 / {semanticStatus.indexedChunks} 个向量块
              {semanticStatus.lastIndexedAt
                ? ` · 更新于 ${new Date(semanticStatus.lastIndexedAt).toLocaleString('zh-CN')}`
                : ''}
            </span>
          </div>
        )}
        {semanticStatus?.error && <div className="form-error">{semanticStatus.error}</div>}
        <label className="field">
          <span>模型下载源</span>
          <input
            value={semanticMirror}
            onChange={(e) => setSemanticMirror(e.target.value)}
            onBlur={() => void updateAppSettings({ semanticMirror: semanticMirror.trim() })}
            placeholder="https://modelscope.cn/models/"
          />
        </label>
        <p className="settings-hint">
          默认走 ModelScope（国内较快，约 400MB）；也可填 <code>https://huggingface.co/</code>
          ，但国内下载可能较慢。修改源后点「重建索引」会重新下载。
        </p>
      </section>

      <section className="settings-section">
        <h2>日记</h2>
        <p className="settings-hint">
          按日期自动创建日记（⌘D 打开今天）。模板可用变量：
          <code>{'{{date}}'}</code>、<code>{'{{date:YYYY年MM月DD日}}'}</code>、
          <code>{'{{time}}'}</code>、<code>{'{{title}}'}</code>、<code>{'{{weekday}}'}</code>。
        </p>
        <div className="settings-grid">
          <label className="field">
            <span>日记目录</span>
            <input
              value={dailyDir}
              onChange={(e) => setDailyDir(e.target.value)}
              onBlur={() => void updateAppSettings({ dailyDir: dailyDir.trim() || '日记' })}
              placeholder="日记"
            />
          </label>
          <label className="field">
            <span>文件名格式</span>
            <input
              value={dailyFormat}
              onChange={(e) => setDailyFormat(e.target.value)}
              onBlur={() => void updateAppSettings({ dailyFormat: dailyFormat.trim() || 'YYYY-MM-DD' })}
              placeholder="YYYY-MM-DD"
            />
          </label>
        </div>
        <label className="field">
          <span>日记模板文件（可选，vault 相对路径）</span>
          <input
            value={dailyTemplate}
            onChange={(e) => setDailyTemplate(e.target.value)}
            onBlur={() => void updateAppSettings({ dailyTemplate: dailyTemplate.trim() })}
            placeholder="templates/日记模板.md"
          />
        </label>
        <p className="settings-hint">留空则使用内置模板（含标题、记录、待办区块）。</p>
      </section>

      <section className="settings-section">
        <h2>知识库</h2>
        <p className="settings-hint">
          当前目录：<code>{vaultPath}</code>
          <br />
          所有笔记都是标准 Markdown，可直接用 Obsidian 打开同一目录。切换到其他文件夹后，
          索引会自动重建（原目录的笔记不会丢失，只是不在当前视图中）。
        </p>
        <div className="settings-actions">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true)
                setMessage(null)
                try {
                  const path = await api.selectDirectory()
                  if (!path) return
                  setVaultPath(await api.setRoot(path))
                  setMessage('已切换知识库目录')
                } catch (err) {
                  setMessage(`切换失败：${err instanceof Error ? err.message : String(err)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }
          >
            选择文件夹…
          </button>
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true)
                setMessage(null)
                try {
                  // 空路径 = 主进程恢复默认目录
                  setVaultPath(await api.setRoot(''))
                  setMessage('已恢复默认目录')
                } finally {
                  setBusy(false)
                }
              })()
            }
          >
            恢复默认
          </button>
        </div>
      </section>

      {message && <div className="settings-message">{message}</div>}
    </div>
  )
}
