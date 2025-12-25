const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dslrAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectCSV: () => ipcRenderer.invoke('select-csv'),
  scanPhotos: (dir) => ipcRenderer.invoke('scan-photos', dir),
  startCopy: (payload) => ipcRenderer.invoke('start-copy', payload),
  parseCsvFolders: (csvPath) => ipcRenderer.invoke('parse-csv-folders', csvPath),
  processSelection: (payload) => ipcRenderer.invoke('process-selection', payload),
  onProcessProgress: (cb) => {
    ipcRenderer.on('process-progress', (event, data) => cb(data))
  }
})
