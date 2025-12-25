const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { parse } = require('csv-parse')
const { Worker } = require('worker_threads')

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, '_')
}

function defaultOptions() {
  return {
    includeRaw: false,
    mode: 'copy',
    collision: 'rename',
    batchSize: 200,
    maxWorkers: Math.max(1, os.cpus().length - 1)
  }
}

function processSelection(payload, progressCb) {
  console.log('[Processor] processSelection called', { csvPath: payload.csvPath, mode: payload.options?.mode })
  const opts = Object.assign(defaultOptions(), payload.options || {})
  const csvPath = payload.csvPath
  const destFolder = payload.destFolder
  const folderMap = payload.folderMap || {}

  // output goes directly to destFolder/foldername/
  function getOutputDir(folderName) {
    return path.join(destFolder, folderName)
  }

  // ensure output subfolders exist for each mapped folder
  async function ensureFolders(uniqueFolders) {
    for (const f of uniqueFolders) {
      const outDir = getOutputDir(f)
      await fsp.mkdir(outDir, { recursive: true })
    }
  }

  // Count rows and dispatch batches to workers
  (async () => {
    console.log('[Processor] Starting async processing loop')
    const unique = new Set()
    // First quick pass to collect unique folders (streaming)
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(csvPath)
      const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true })
      rs.pipe(parser)
      parser.on('readable', () => {
        let rec
        while ((rec = parser.read())) {
          const name = rec.FolderName || rec.folder_name || rec.folderName || ''
          if (name) unique.add(name)
        }
      })
      parser.on('end', resolve)
      parser.on('error', reject)
      rs.on('error', reject)
    })

    console.log('[Processor] Unique folders found:', Array.from(unique))
    // determine which folders have been mapped by the user
    const mappedFolders = Array.from(unique).filter(f => folderMap[f])
    if (mappedFolders.length === 0) {
      console.log('[Processor] No mapped folders, returning error')
      progressCb({ type: 'error', message: 'No folders mapped. Map at least one folder to proceed.' })
      return
    }
    console.log('[Processor] Mapped folders:', mappedFolders)

    // only create output subfolders for mapped folders
    await ensureFolders(mappedFolders)

    // prepare worker pool
    const maxWorkers = opts.maxWorkers
    const workers = []
    const idle = []
    for (let i = 0; i < maxWorkers; i++) {
      const w = new Worker(path.join(__dirname, 'worker.js'))
      workers.push(w)
      idle.push(i)
    }

    let totalJobs = 0
    let completed = 0
    let failed = 0
    const perFolder = {} // { folderName: { matched:[], missing:[], copied:0, failed:0 }}

    // Setup worker message handlers
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i]
      w.on('message', msg => {
        if (msg.type === 'progress') {
          completed += msg.processed || 0
          const fn = msg.folderName || 'unknown'
          perFolder[fn] = perFolder[fn] || { matched: [], missing: [], copied: 0, failed: 0 }
          perFolder[fn].copied += 1
          if (progressCb) progressCb({ type: 'progress', completed, failed, totalJobs, perFolder })
        } else if (msg.type === 'error') {
          failed++
          const fn = msg.folderName || 'unknown'
          perFolder[fn] = perFolder[fn] || { matched: [], missing: [], copied: 0, failed: 0 }
          perFolder[fn].failed += 1
          if (progressCb) progressCb({ type: 'error', error: msg.error, perFolder })
        } else if (msg.type === 'batch_done') {
          // worker finished a batch; nothing special here
        }
      })
      w.on('exit', code => {
        if (code !== 0) {
          if (progressCb) progressCb({ type: 'error', error: 'Worker exited with ' + code })
        }
        idle.push(i)
      })
      w.on('error', err => {
        if (progressCb) progressCb({ type: 'error', error: err.message })
      })
    }

    // streaming second pass: create batches and dispatch
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(csvPath)
      const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true })
      rs.pipe(parser)
      let batch = []
      let skippedRows = 0
      const pendingScans = []

      function dispatchBatch(b) {
        totalJobs += b.length
        const tryDispatch = () => {
          if (idle.length === 0) {
            // wait and retry
            setTimeout(tryDispatch, 50)
            return
          }
          const workerIndex = idle.shift()
          const w = workers[workerIndex]
          w.postMessage({ jobs: b, options: opts })
        }
        tryDispatch()
      }

      parser.on('readable', () => {
        let rec
        while ((rec = parser.read())) {
          const folderName = rec.FolderName || rec.folder_name || rec.folderName || ''
          const imageName = rec.fileName || rec.file_name || rec.file || rec.fileName || ''
          if (!folderName || !imageName) continue
          // only create jobs for folders the user has mapped
          if (!folderMap[folderName]) {
            skippedRows++
            continue
          }

          // initialize per-folder lists
          perFolder[folderName] = perFolder[folderName] || { matched: [], missing: [], copied: 0, failed: 0 }

          const srcDir = folderMap[folderName]
          const destDir = getOutputDir(folderName)

          if (opts.mode === 'scan') {
            // in scan mode, perform async existence check and record
            const p = (async () => {
              const src = path.join(srcDir, imageName)
              try {
                await fsp.access(src)
                perFolder[folderName].matched.push(imageName)
              } catch (e) {
                perFolder[folderName].missing.push(imageName)
              }
              totalJobs++
              // emit progress after every file in scan mode
              if (progressCb) progressCb({ type: 'progress', totalJobs, perFolder })
            })()
            pendingScans.push(p)
          } else {
            batch.push({ folderName, imageName, srcDir, destDir, options: opts })
            if (batch.length >= opts.batchSize) {
              const b = batch
              batch = []
              dispatchBatch(b)
            }
          }
        }
      })

      parser.on('end', async () => {
        console.log('[Processor] CSV parsing ended, mode:', opts.mode, 'totalJobs:', totalJobs)
        if (opts.mode === 'scan') {
          // emit initial scan progress before waiting
          if (progressCb) progressCb({ type: 'progress', totalJobs, perFolder })
          // wait for all existence checks
          await Promise.all(pendingScans)
          console.log('[Processor] Scan complete, sending done')
          if (progressCb) progressCb({ type: 'done', totalJobs, completed: 0, failed: 0, perFolder, skipped: skippedRows })
          resolve()
          return
        }
        if (batch.length > 0) dispatchBatch(batch)
        // wait for workers to finish their work
        const checkDone = () => {
          if (completed + failed >= totalJobs) {
            // cleanup workers
            for (const w of workers) w.terminate()
            if (progressCb) progressCb({ type: 'done', totalJobs, completed, failed, perFolder })
            resolve()
          } else {
            setTimeout(checkDone, 200)
          }
        }
        if (totalJobs === 0) {
          for (const w of workers) w.terminate()
          if (progressCb) progressCb({ type: 'done', totalJobs, completed, failed, perFolder, skipped: skippedRows })
          resolve()
        } else {
          checkDone()
        }
      })
      parser.on('error', reject)
      rs.on('error', reject)
    })
  })().catch(err => {
    if (progressCb) progressCb({ type: 'error', error: err.message })
  })
}

module.exports = { processSelection }
