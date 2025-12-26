const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { parse } = require('csv-parse')
const { Worker } = require('worker_threads')
const { dialog } = require('electron')

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, '_')
}

function defaultOptions() {
  return {
    includeRaw: false,
    mode: 'copy',
    collision: 'prompt',
    batchSize: 200,
    maxWorkers: Math.max(1, os.cpus().length - 1)
  }
}

function processSelection(payload, progressCb) {
  console.log('[Processor] processSelection called', { csvPath: payload.csvPath, mode: payload.options?.mode })
  const opts = Object.assign(defaultOptions(), payload.options || {})
  // enforce sequential copying (one by one) when in copy mode
  if (opts.mode === 'copy') opts.maxWorkers = 1
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
          // include current file info in progress callback
          if (progressCb) progressCb({ type: 'progress', completed, failed, totalJobs, perFolder, currentFile: msg.file, imageName: msg.imageName, folderName: fn })
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

    // streaming second pass: create jobs grouped by folder, then process folder by folder
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(csvPath)
      const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true })
      rs.pipe(parser)
      let skippedRows = 0
      const pendingScans = []
      const jobsByFolder = {} // { folderName: [job, ...] }

      parser.on('readable', () => {
        let rec
        while ((rec = parser.read())) {
          const folderName = rec.FolderName || rec.folder_name || rec.folderName || ''
          const imageName = rec.fileName || rec.file_name || rec.file || rec.fileName || ''
          if (!folderName || !imageName) continue
          if (!folderMap[folderName]) {
            skippedRows++
            continue
          }
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
              if (progressCb) progressCb({ type: 'progress', totalJobs, perFolder })
            })()
            pendingScans.push(p)
          } else {
            // prepare list of filenames to copy: include RAW variants if requested
            const rawExts = ['.cr2', '.nef', '.arw', '.rw2', '.dng', '.raw', '.raf']
            const baseName = path.parse(imageName).name
            const namesToCopy = [imageName]
            if (opts.includeRaw) {
              for (const re of rawExts) {
                const cand = baseName + re
                try {
                  if (fs.existsSync(path.join(srcDir, cand))) namesToCopy.push(cand)
                } catch (e) {}
              }
            }
            if (!jobsByFolder[folderName]) jobsByFolder[folderName] = []
            for (const nameToCopy of namesToCopy) {
              jobsByFolder[folderName].push({ folderName, imageName: nameToCopy, srcDir, destDir, options: opts })
            }
          }
        }
      })

      parser.on('end', async () => {
        if (opts.mode === 'scan') {
          if (progressCb) progressCb({ type: 'progress', totalJobs, perFolder })
          await Promise.all(pendingScans)
          if (progressCb) progressCb({ type: 'done', totalJobs, completed: 0, failed: 0, perFolder, skipped: skippedRows })
          resolve()
          return
        }

        // --- RESTORE LINE-BY-LINE (CSV ORDER) BATCH LOGIC ---
        let allJobs = []
        // flatten jobsByFolder into CSV order
        for (const folderName of Object.keys(jobsByFolder)) {
          for (const job of jobsByFolder[folderName]) {
            allJobs.push(job)
          }
        }
        totalJobs = allJobs.length
        console.log(`[Processor] Total jobs found in CSV after filtering: ${totalJobs}`)
        if (progressCb) progressCb({ type: 'progress', totalJobs, perFolder })

        // Process jobs one by one, no batching
        let cancelled = false
        for (const job of allJobs) {
          // handle collision prompt logic synchronously per job
          const destPath = path.join(job.destDir, job.imageName)
          let overwrite = false
          if (fs.existsSync(destPath) && opts.collision === 'prompt') {
            if (opts._skipAll) {
              skippedRows++
              continue
            }
            if (!opts._overwriteAll) {
              const choice = dialog.showMessageBoxSync({
                type: 'question',
                buttons: ['Overwrite','Skip','Overwrite All','Skip All','Cancel'],
                defaultId: 0,
                cancelId: 4,
                title: 'File exists',
                message: `File already exists in destination:\n${destPath}\nWhat would you like to do?`,
                noLink: true
              })
              if (choice === 4) {
                if (progressCb) progressCb({ type: 'error', error: 'Operation cancelled by user' })
                cancelled = true
                break
              } else if (choice === 1) {
                skippedRows++
                continue
              } else if (choice === 2) {
                opts._overwriteAll = true
                overwrite = true
              } else if (choice === 3) {
                opts._skipAll = true
                skippedRows++
                continue
              } else if (choice === 0) {
                overwrite = true
              }
            } else {
              overwrite = true
            }
          }
          // Dispatch this job to the worker and wait for completion
          const singleJob = [{ ...job, overwrite }]
          await dispatchBatchAndWait(singleJob, workers, idle, opts)
        }
        console.log(`[Processor] All jobs dispatched. Total dispatched: ${cancelled ? 'cancelled early' : allJobs.length}`)
        if (cancelled) {
          console.log('[Processor] Loop exited due to user cancellation.')
          resolve()
          return
        }

        // wait for workers to finish their work
        const checkDone = () => {
          if (completed + failed >= totalJobs) {
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

    // Helper: dispatch a batch and wait for it to finish (sequentially)
    async function dispatchBatchAndWait(batch, workers, idle, opts) {
      return new Promise((resolve) => {
        function tryDispatch() {
          if (idle.length === 0) {
            setTimeout(tryDispatch, 50)
            return
          }
          const workerIndex = idle.shift()
          const w = workers[workerIndex]
          console.log(`[Processor] Dispatching batch of ${batch.length} jobs to worker #${workerIndex}`)
          // Only listen for batch_done for this job
          const batchDoneHandler = (msg) => {
            if (msg.type === 'batch_done') {
              console.log(`[Processor] Worker #${workerIndex} finished batch of ${batch.length} jobs`)
              idle.push(workerIndex)
              w.removeListener('message', batchDoneHandler)
              resolve()
            }
          }
          w.on('message', batchDoneHandler)
          w.postMessage({ jobs: batch, options: opts })
        }
        tryDispatch()
      })
    }
  })().catch(err => {
    if (progressCb) progressCb({ type: 'error', error: err.message })
  })
}

module.exports = { processSelection }
