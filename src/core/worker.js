const { parentPort } = require('worker_threads')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')

function makeDestUnique(dest) {
  return fsp.access(dest).then(() => {
    const parsed = path.parse(dest)
    let i = 1
    const tryName = () => {
      const candidate = path.join(parsed.dir, parsed.name + '_' + i + parsed.ext)
      return fsp.access(candidate).then(() => { i++; return tryName() }).catch(() => candidate)
    }
    return tryName()
  }).catch(() => dest)
}

async function processJob(job) {
  const src = path.join(job.srcDir, job.imageName)
  const dest = path.join(job.destDir, job.imageName)
  try {
    await fsp.access(src)
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: 'Missing: ' + src })
    return { success: false }
  }

  let finalDest = dest
  if (job.options.collision === 'rename') {
    finalDest = await makeDestUnique(dest)
  }

  try {
    if (job.options.mode === 'move') {
      try {
        await fsp.rename(src, finalDest)
      } catch (err) {
        if (err.code === 'EXDEV') {
          await streamCopy(src, finalDest)
          await fsp.unlink(src)
        } else throw err
      }
    } else {
      await streamCopy(src, finalDest)
    }
    parentPort.postMessage({ type: 'progress', processed: 1, file: src, folderName: job.folderName, imageName: job.imageName })
    return { success: true }
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: err.message, file: src, folderName: job.folderName, imageName: job.imageName })
    return { success: false }
  }
}

function streamCopy(src, dest) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(src)
    const ws = fs.createWriteStream(dest)
    rs.on('error', reject)
    ws.on('error', reject)
    ws.on('finish', resolve)
    rs.pipe(ws)
  })
}

parentPort.on('message', async (msg) => {
  const jobs = msg.jobs || []
  for (const job of jobs) {
    await processJob(job)
  }
  // signal finished batch
  parentPort.postMessage({ type: 'batch_done', processed: jobs.length })
})
