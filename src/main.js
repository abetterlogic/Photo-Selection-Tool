const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const { parse } = require('csv-parse')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // disable DevTools in packaged (production) builds
      devTools: !app.isPackaged
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  
  // Create menu: include dev tools only when not packaged (development)

  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://e.dslr.app/helplink/selfie-search-sorting')
          }
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About DSLR Photo Copier Tool',
              message: 'DSLR Photo Copier Tool\nVersion 0.1.1\n\nAuthor: Nishant Pandey\nEmail: info@dslr.app',
              detail: 'A cross-platform tool for photographers to batch copy photos using CSV mapping.\nhttps://dslr.app',
              buttons: ['OK']
            })
          }
        }
      ]
    }
  ]

  if (!app.isPackaged) {
    // In development allow reload/devtools
    template.unshift({
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { type: 'separator' },
        { role: 'toggledevtools' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  // In packaged builds, hide the menu bar on Windows/Linux to avoid exposing dev shortcuts
  if (app.isPackaged) {
    try {
      mainWindow.setMenuBarVisibility(false)
      mainWindow.setAutoHideMenuBar(true)
    } catch (e) {
      // ignore if API not available in some Electron versions/platforms
    }
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('select-directory', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (res.canceled) return null
  return res.filePaths[0]
})

ipcMain.handle('select-csv', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })
  if (res.canceled) return null
  return res.filePaths[0]
})

ipcMain.handle('parse-csv-folders', async (_, csvPath) => {
  try {
    const unique = new Set()
    const folderCounts = {}
    let totalRows = 0
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(csvPath)
      const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true })
      rs.pipe(parser)
      parser.on('readable', () => {
        let record
        while ((record = parser.read())) {
          totalRows++
          const name = record.FolderName || record.folder_name || record.folderName || record.Folder || ''
          if (name) {
            unique.add(name)
            folderCounts[name] = (folderCounts[name] || 0) + 1
          }
        }
      })
      parser.on('end', resolve)
      parser.on('error', reject)
      rs.on('error', reject)
    })
    return { success: true, folders: Array.from(unique), totalRows, folderCounts }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('process-selection', async (_, payload) => {
  console.log('[Main] process-selection called with:', { csvPath: payload.csvPath, folderMap: Object.keys(payload.folderMap || {}), mode: payload.options?.mode })
  try {
    const processor = require(path.join(__dirname, 'core', 'processor'))
    console.log('[Main] processor module loaded')
    // processor will stream CSV again and report progress via provided callback
    processor.processSelection(payload, (progress) => {
      console.log('[Main] progress callback:', progress.type)
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('process-progress', progress)
    })
    console.log('[Main] processSelection initiated')
    return { success: true }
  } catch (err) {
    console.error('[Main] process-selection error:', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('open-external', async (_, url) => {
  try {
    // Open URL in the user's default browser
    await shell.openExternal(url)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

const photoExts = new Set(['.jpg', '.jpeg', '.png', '.heic', '.raw', '.cr2', '.nef', '.arw', '.rw2', '.dng'])

async function scanDir(dir) {
  const results = []
  async function walk(d) {
    const entries = await fsp.readdir(d, { withFileTypes: true })
    for (const ent of entries) {
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) {
        await walk(full)
      } else {
        const ext = path.extname(ent.name).toLowerCase()
        if (photoExts.has(ext)) results.push(full)
      }
    }
  }
  await walk(dir)
  return results
}

ipcMain.handle('scan-photos', async (_, dir) => {
  try {
    const files = await scanDir(dir)
    return { success: true, files }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('start-copy', async (_, { files, dest }) => {
  try {
    await fsp.mkdir(dest, { recursive: true })
    for (let i = 0; i < files.length; i++) {
      const src = files[i]
      const base = path.basename(src)
      let destPath = path.join(dest, base)
      let counter = 1
      while (fs.existsSync(destPath)) {
        const name = path.parse(base).name
        const ext = path.parse(base).ext
        destPath = path.join(dest, `${name}_${counter}${ext}`)
        counter++
      }
      await fsp.copyFile(src, destPath)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('copy-progress', { index: i + 1, total: files.length, file: src })
      }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
