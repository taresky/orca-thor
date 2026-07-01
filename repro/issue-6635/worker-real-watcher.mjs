// Exercises the REAL @parcel/watcher subscribe/teardown loop inside worker
// threads under filesystem churn, mirroring the lifecycle that aborts in
// #5377/#6635 (native error during worker FreeEnvironment/CleanupHandles).
//
// This is a stress probe, not a deterministic repro: the underlying bug is a
// use-after-free race during teardown, so it may or may not abort on a given
// run. What it proves structurally: if it DOES abort while running in a
// worker_thread, the whole process dies (status 134); the prong-A fix moves
// this exact loop into a child process where that abort is survivable.
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROUNDS = Number(process.env.WATCHER_ROUNDS ?? 40)

if (isMainThread) {
  let completed = 0
  const spawnRound = () => {
    const worker = new Worker(new URL(import.meta.url), { workerData: {} })
    worker.on('message', (m) => {
      if (m === 'done') {
        completed++
        if (completed >= ROUNDS) {
          console.log(`[real-watcher] completed ${completed} subscribe/teardown rounds, no abort`)
          process.exit(0)
        }
        worker.terminate().then(spawnRound, spawnRound)
      }
    })
    worker.on('error', (err) => {
      console.log('[real-watcher] worker error (JS-catchable):', err?.message)
      process.exit(2)
    })
  }
  spawnRound()
} else {
  const watcher = await import('@parcel/watcher')
  const dir = mkdtempSync(join(tmpdir(), 'orca-6635-'))
  const sub = await watcher.subscribe(dir, () => {})
  // Churn the tree so the native watcher has inflight work during teardown.
  for (let i = 0; i < 50; i++) {
    writeFileSync(join(dir, `f${i}.txt`), String(i))
  }
  await sub.unsubscribe()
  rmSync(dir, { recursive: true, force: true })
  parentPort.postMessage('done')
}
