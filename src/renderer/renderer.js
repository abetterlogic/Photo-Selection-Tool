const btnCsv = document.getElementById('btnCsv')
const csvPathEl = document.getElementById('csvPath')
const mappingDiv = document.getElementById('mapping')
const summary = document.getElementById('summary')
const progress = document.getElementById('progress')

let csvPath = null
let folderMap = {}
let uniqueFolders = []
let destFolder = null

btnCsv.addEventListener('click', async () => {
  const sel = await window.dslrAPI.selectCSV()
  if (!sel) return
  csvPath = sel
  csvPathEl.textContent = sel
  summary.textContent = 'Parsing CSV for folders...'
  const res = await window.dslrAPI.parseCsvFolders(sel)
  if (!res.success) {
    summary.textContent = 'CSV parse error: ' + res.error
    return
  }
  uniqueFolders = res.folders
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
    btn.addEventListener('click', async () => {
      const d = await window.dslrAPI.selectDirectory()
      if (d) {
        input.value = d
        folderMap[f] = d
      }
    })
    const scanBtn = document.createElement('button')
    scanBtn.textContent = 'Scan'
    scanBtn.style.marginLeft = '8px'
    scanBtn.addEventListener('click', () => scanSingleFolder(f, input.value))
    row.appendChild(label)
    row.appendChild(input)
    row.appendChild(btn)
    row.appendChild(scanBtn)
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
  const mappedCount = Object.keys(folderMap).length
  console.log('Mapped folders:', mappedCount, folderMap)
  if (mappedCount === 0) return alert('Please map at least one folder to proceed')
  if (!csvPath) return alert('Please select a CSV file first')
  
  if (mode === 'copy' && !destFolder) return alert('Please select a destination folder first')
  
  console.log('Starting process with destFolder:', destFolder)
  summary.textContent = (mode === 'scan') ? 'Scanning...' : 'Copying...'
  progress.value = 0
  
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
    const result = await window.dslrAPI.processSelection({ csvPath, destFolder, folderMap, options: { includeRaw: false, mode } })
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
    summary.textContent = `Processing: ${data.totalJobs || 0} files scanned`
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
    summary.textContent = `✓ Done. Scanned ${data.totalJobs || 0} files`
    renderPerFolder(data.perFolder)
    const loader = document.getElementById('loading-spinner')
    if (loader) loader.remove()
    if (data.skipped) {
      const note = document.createElement('div')
      note.style.marginTop = '8px'
      note.style.fontSize = '0.9em'
      note.style.color = '#666'
      note.textContent = `Skipped rows (unmapped folders): ${data.skipped}`
      mappingDiv.appendChild(note)
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
