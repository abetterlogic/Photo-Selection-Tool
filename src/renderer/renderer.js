const btnCsv = document.getElementById('btnCsv')
const csvPathEl = document.getElementById('csvPath')
const csvInfoEl = document.getElementById('csvInfo')
const mappingDiv = document.getElementById('mapping')
const summary = document.getElementById('summary')
const progress = document.getElementById('progress')
const chkRaw = document.getElementById('chkRaw')
const appTitle = document.getElementById('appTitle')
const btnHowTo = document.getElementById('btnHowTo')

let csvPath = null
let folderMap = {}
let uniqueFolders = []
let destFolder = null
let csvFolderCounts = {}
let currentMode = null

btnCsv.addEventListener('click', async () => {
  const sel = await window.dslrAPI.selectCSV()
  if (!sel) return
  csvPath = sel
  // set the input value and show filename + full path below the input
  try {
    csvPathEl.value = sel
  } catch (e) {
    // fallback for non-input elements
    csvPathEl.textContent = sel
  }
    const parts = sel.split(/[\\/]/)
  const filename = parts[parts.length - 1]
  // show filename immediately while parsing
  if (csvInfoEl) csvInfoEl.textContent = filename + ' — ' + sel
  summary.textContent = 'Parsing CSV for folders...'
  const res = await window.dslrAPI.parseCsvFolders(sel)
  if (!res.success) {
    summary.textContent = 'CSV parse error: ' + res.error
    return
  }
  uniqueFolders = res.folders
  csvFolderCounts = res.folderCounts || {}
  // if parser returned totals, display them
  if (csvInfoEl) {
    const total = res.totalRows || 0
    const folders = Array.isArray(res.folders) ? res.folders.length : Object.keys(res.folderCounts || {}).length
    csvInfoEl.textContent = `${filename} — ${total} photos across ${folders} folders`
  }
  renderFolderMapping(uniqueFolders)
  summary.textContent = `Found ${uniqueFolders.length} folders in CSV`
})

// Destination folder selection
const btnDestFolder = document.getElementById('btnDestFolder')
const btnCopyPhotos = document.getElementById('btnCopyPhotos')
const destFolderInput = document.getElementById('destFolder')
btnDestFolder.addEventListener('click', async () => {
  const sel = await window.dslrAPI.selectDirectory()
  if (sel) {
    destFolder = sel
    destFolderInput.value = sel
  }
})

btnCopyPhotos.addEventListener('click', () => {
  if (!destFolder) return alert('Please select a destination folder first')
  startProcessing('copy')
})

if (appTitle) {
  appTitle.style.cursor = 'pointer'
  appTitle.addEventListener('click', async () => {
    const url = 'https://www.dslr.app'
    try {
      await window.dslrAPI.openExternal(url)
    } catch (e) {
      window.open(url, '_blank')
    }
  })
}

if (btnHowTo) {
  const HELP_URL = 'https://e.dslr.app/helplink/selfie-search-sorting'
  btnHowTo.addEventListener('click', async () => {
    try {
      await window.dslrAPI.openExternal(HELP_URL)
    } catch (e) {
      window.open(HELP_URL, '_blank')
    }
  })
}

function renderFolderMapping(folders) {
  mappingDiv.innerHTML = ''
  const folderRows = {}
  
  folders.forEach(f => {
    const row = document.createElement('div')
    row.className = 'map-row'
    const label = document.createElement('div')
    label.textContent = f
    label.style.flex = '1'
    label.style.minWidth = '100px'
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = 'Select folder...'
    input.id = 'map-' + f
    input.style.flex = '2'
    const btn = document.createElement('button')
    btn.textContent = 'Choose'
    btn.className = 'btn btn-secondary btn-small'
    btn.addEventListener('click', async () => {
      const d = await window.dslrAPI.selectDirectory()
      if (d) {
        input.value = d
        folderMap[f] = d
      }
    })
    const scanBtn = document.createElement('button')
    scanBtn.textContent = 'Scan'
    scanBtn.className = 'btn btn-primary btn-small'
    scanBtn.addEventListener('click', () => scanSingleFolder(f, input.value))

    const actions = document.createElement('div')
    actions.className = 'map-actions'
    actions.appendChild(btn)
    actions.appendChild(scanBtn)

    row.appendChild(label)
    row.appendChild(input)
    row.appendChild(actions)
    mappingDiv.appendChild(row)
    folderRows[f] = row
    
    // Create result row (hidden by default)
    const resultRow = document.createElement('div')
    resultRow.id = 'result-' + f
    resultRow.style.display = 'none'
    resultRow.style.paddingLeft = '16px'
    resultRow.style.marginBottom = '8px'
    resultRow.style.fontSize = '0.9em'
    mappingDiv.appendChild(resultRow)
  })
  
  // Store folder rows for later updates
  window.folderRows = folderRows
}

async function startProcessing(mode) {
  console.log('startProcessing called with mode:', mode)
  currentMode = mode
  const mappedCount = Object.keys(folderMap).length
  console.log('Mapped folders:', mappedCount, folderMap)
  if (mappedCount === 0) return alert('Please map at least one folder to proceed')
  if (!csvPath) return alert('Please select a CSV file first')
  
  if (mode === 'copy' && !destFolder) return alert('Please select a destination folder first')
  
  console.log('Starting process with destFolder:', destFolder)
  summary.textContent = (mode === 'scan') ? 'Scanning...' : 'Copying...'
  progress.value = 0
  progress.max = 0
  
  // Clear previous report
  const existingReport = document.getElementById('per-folder-report')
  if (existingReport) existingReport.remove()
  
  // Add loading indicator
  const loader = document.createElement('div')
  loader.id = 'loading-spinner'
  loader.style.marginTop = '12px'
  loader.style.textAlign = 'center'
  loader.innerHTML = '<div class="loader"></div><div style="color: #a0a0a0; margin-top: 12px;">Processing...</div>'
  mappingDiv.appendChild(loader)
  
  try {
    const includeRaw = chkRaw ? !!chkRaw.checked : false
    const result = await window.dslrAPI.processSelection({ csvPath, destFolder, folderMap, options: { includeRaw, mode } })
    console.log('processSelection result:', result)
  } catch (err) {
    console.error('processSelection error:', err)
    alert('Error: ' + err.message)
  }
}

async function scanSingleFolder(folderName, srcPath) {
  if (!srcPath) return alert('Please choose a folder first')
  if (!csvPath) return alert('Please select a CSV file first')
  
  console.log('Scanning single folder:', folderName, 'at', srcPath)
  currentMode = 'scan'
  summary.textContent = 'Scanning: ' + folderName + '...'
  
  // Clear previous report
  const existingReport = document.getElementById('per-folder-report')
  if (existingReport) existingReport.remove()
  
  // Add loading indicator
  const loader = document.createElement('div')
  loader.id = 'loading-spinner'
  loader.style.marginTop = '12px'
  loader.style.textAlign = 'center'
  loader.innerHTML = '<div class="loader"></div><div style="color: #a0a0a0; margin-top: 12px;">Scanning...</div>'
  mappingDiv.appendChild(loader)
  
  try {
    // Scan single folder by passing folderMap with only that folder
    const singleFolderMap = { [folderName]: srcPath }
    const result = await window.dslrAPI.processSelection({ csvPath, destFolder: '/tmp', folderMap: singleFolderMap, options: { includeRaw: false, mode: 'scan' } })
    console.log('Single folder scan result:', result)
  } catch (err) {
    console.error('Single folder scan error:', err)
    alert('Error: ' + err.message)
  }
}

window.dslrAPI.onProcessProgress((data) => {
  if (data.type === 'progress') {
    // copy mode: show X/Y and current file
    if (currentMode === 'copy') {
      const total = data.totalJobs || 0
      const done = data.completed || 0
      progress.max = total || 1
      progress.value = done
      const file = data.currentFile || data.imageName || ''
      const short = file ? file.split(/[\\/]/).pop() : ''
      summary.textContent = `Copying: ${done}/${total}` + (short ? ` — ${short}` : '')
    } else {
      summary.textContent = `Processing: ${data.totalJobs || 0} files scanned`
    }
    renderPerFolder(data.perFolder)
    // remove loading spinner on first progress
    const loader = document.getElementById('loading-spinner')
    if (loader) loader.remove()
  } else if (data.type === 'error') {
    summary.textContent = 'Error: ' + data.error
    renderPerFolder(data.perFolder)
    const loader = document.getElementById('loading-spinner')
    if (loader) loader.remove()
  } else if (data.type === 'done') {
    // finished
    renderPerFolder(data.perFolder)
    const loader = document.getElementById('loading-spinner')
    if (loader) loader.remove()
    if (currentMode === 'copy') {
      const totalCopied = data.completed || Object.values(data.perFolder || {}).reduce((s, v) => s + (v.copied || 0), 0)
      // build folder summary
      const parts = []
      for (const k of Object.keys(data.perFolder || {})) {
        const v = data.perFolder[k]
        parts.push(`${k}: ${v.copied || 0}`)
      }
      const details = parts.join(', ')
      summary.textContent = `✓ Done. Copied ${totalCopied} files.` + (details ? ` ${details}` : '')
      progress.value = progress.max || progress.value
    } else {
      summary.textContent = `✓ Done. Scanned ${data.totalJobs || 0} files`
    }
  }
})

function renderPerFolder(perFolder) {
  if (!perFolder) return
  
  // Clear old per-folder-report if it exists
  const oldReport = document.getElementById('per-folder-report')
  if (oldReport) oldReport.remove()
  
  for (const folderName of Object.keys(perFolder)) {
    const v = perFolder[folderName]
    const resultRow = document.getElementById('result-' + folderName)
    if (!resultRow) continue
    
    resultRow.innerHTML = ''
    resultRow.style.display = 'block'
    
    const matched = Array.isArray(v.matched) ? v.matched.length : v.matched || 0
    const missing = Array.isArray(v.missing) ? v.missing.length : v.missing || 0

    // show total photos from the original CSV (if available)
    const totalCsv = csvFolderCounts && csvFolderCounts[folderName] ? csvFolderCounts[folderName] : null
    if (totalCsv !== null) {
      const totalSpan = document.createElement('span')
      totalSpan.style.color = '#bfbfbf'
      totalSpan.style.marginRight = '12px'
      totalSpan.textContent = `Total (CSV): ${totalCsv}`
      resultRow.appendChild(totalSpan)
    }

    const matchedSpan = document.createElement('span')
    matchedSpan.style.cursor = 'pointer'
    matchedSpan.style.textDecoration = 'underline'
    matchedSpan.style.color = '#008000'
    matchedSpan.style.marginRight = '12px'
    matchedSpan.textContent = `Matched: ${matched}`
    matchedSpan.title = 'Click to see matched files'
    if (Array.isArray(v.matched) && v.matched.length > 0) {
      matchedSpan.addEventListener('click', () => showFilesModal(folderName, 'Matched Files', v.matched))
    } else {
      matchedSpan.style.cursor = 'default'
      matchedSpan.style.textDecoration = 'none'
    }
    resultRow.appendChild(matchedSpan)
    
    const missingSpan = document.createElement('span')
    missingSpan.style.cursor = 'pointer'
    missingSpan.style.textDecoration = 'underline'
    missingSpan.style.color = '#d00'
    missingSpan.style.marginRight = '12px'
    missingSpan.textContent = `Missing: ${missing}`
    missingSpan.title = 'Click to see missing files'
    if (Array.isArray(v.missing) && v.missing.length > 0) {
      missingSpan.addEventListener('click', () => showFilesModal(folderName, 'Missing Files', v.missing))
    } else {
      missingSpan.style.cursor = 'default'
      missingSpan.style.textDecoration = 'none'
    }
    resultRow.appendChild(missingSpan)
    
    if (v.copied || v.failed) {
      const copiedSpan = document.createElement('span')
      copiedSpan.style.color = '#666'
      copiedSpan.style.marginRight = '12px'
      copiedSpan.textContent = `Copied: ${v.copied || 0}`
      resultRow.appendChild(copiedSpan)
      
      const failedSpan = document.createElement('span')
      failedSpan.style.color = '#d00'
      failedSpan.textContent = `Failed: ${v.failed || 0}`
      resultRow.appendChild(failedSpan)
    }
  }
}

function showFilesModal(folderName, title, files) {
  // Create modal overlay
  const modal = document.createElement('div')
  modal.className = 'modal-overlay'
  
  // Create modal content
  const content = document.createElement('div')
  content.className = 'modal-content'
  
  const titleEl = document.createElement('h3')
  titleEl.textContent = `${title} in "${folderName}" (${files.length} total)`
  content.appendChild(titleEl)
  
  const fileList = document.createElement('ul')
  files.forEach(f => {
    const li = document.createElement('li')
    li.textContent = f
    fileList.appendChild(li)
  })
  content.appendChild(fileList)
  
  const closeBtn = document.createElement('button')
  closeBtn.textContent = 'Close'
  closeBtn.className = 'btn btn-primary'
  closeBtn.addEventListener('click', () => modal.remove())
  content.appendChild(closeBtn)
  
  modal.appendChild(content)
  document.body.appendChild(modal)
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove()
  })
}
