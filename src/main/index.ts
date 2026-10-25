import { app, BrowserWindow, Menu, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerServices } from './ipc/register'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// 自定义协议：渲染层通过 secbrain-file://vault/<相对路径> 加载知识库内的图片等资源
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'secbrain-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/** 标准应用菜单：保证 ⌘C/⌘V/⌘A/⌘W 等 Mac 快捷键在输入框中原生可用 */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 启用内置 PDF 查看器（iframe 内嵌 PDF 需要）
      plugins: true
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  buildMenu()
  const services = registerServices()

  // secbrain-file://vault/<path> → 当前知识库目录下的文件
  protocol.registerFileProtocol('secbrain-file', (request, callback) => {
    try {
      const url = new URL(request.url)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      // 防目录逃逸
      if (!rel || rel.split('/').includes('..')) {
        callback({ error: -6 })
        return
      }
      callback({ path: join(services.notes.vaultRoot, rel) })
    } catch {
      callback({ error: -2 })
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
