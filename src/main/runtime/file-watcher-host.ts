// Why: spawns the file-watcher CHILD PROCESS and adapts it to the synchronous
// `watchFileExplorer` contract (a promise that resolves to an unsubscribe fn
// once the recursive crawl is live). Running @parcel/watcher in a forked child
// keeps its blocking initial crawl off the main process's libuv pool so a huge
// non-git tree can't wedge the `serve` runtime (issue #5308), and isolates the
// native addon's process-fatal teardown abort (`Napi::Error` -> terminate() ->
// SIGABRT). On a worker_thread that abort is uncatchable and kills the whole
// serve process; in a child process it surfaces here as a catchable `exit`
// event, so the watch degrades to an overflow refresh instead (#6635/#5377).
import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { FsChangeEvent } from '../../shared/types'
import type { FileWatcherChildMessage, FileWatcherHostMessage } from './file-watcher-process'

// Mirrors VS Code's predefined recursive-watch excludes: skip churny generated
// trees at crawl time so the watcher never traverses them.
const RUNTIME_FILE_WATCH_IGNORE = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
  'target',
  '.venv'
]

// Why: clean teardown is async (the child awaits subscription.unsubscribe()
// before exiting). Wait this long for the child to exit on its own before
// force-killing, so the native watcher thread isn't freed mid-flight.
const CHILD_TEARDOWN_TIMEOUT_MS = 5000
type ChildExitWaitResult = 'exit' | 'timeout'

function getFileWatcherChildPath(): string {
  // Why: the child is forked with ELECTRON_RUN_AS_NODE, which bypasses
  // Electron's asar require integration, so the entry must live on disk in
  // app.asar.unpacked rather than inside app.asar (mirrors daemon-entry /
  // computer-sidecar).
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'out',
      'main',
      'file-watcher-process.js'
    )
  }
  return join(__dirname, 'file-watcher-process.js')
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<ChildExitWaitResult> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let onExit: (() => void) | undefined
    const finish = (result: ChildExitWaitResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      if (onExit) {
        child.off('exit', onExit)
      }
      resolve(result)
    }

    onExit = () => finish('exit')
    child.once('exit', onExit)
    timer = setTimeout(() => finish('timeout'), timeoutMs)
  })
}

/** Start a recursive file watch in a child process. Resolves to an unsubscribe
 *  function once the child reports the crawl is live; rejects if the child
 *  fails to start the watch. */
export function watchFileExplorerInWorker(
  rootPath: string,
  callback: (events: FsChangeEvent[]) => void
): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const child = fork(getFileWatcherChildPath(), [], {
      // Why: ELECTRON_RUN_AS_NODE runs the child as plain Node (no Electron
      // GPU/display init that can interfere with native modules). The watch
      // target rides env, not argv, so spaces/quotes in the path survive.
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_FILE_WATCH_ROOT: rootPath,
        ORCA_FILE_WATCH_IGNORE: RUNTIME_FILE_WATCH_IGNORE.join('\n')
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      ...(process.platform === 'win32' ? { windowsHide: true } : {})
    })

    let ready = false
    let disposed = false
    let exited = false
    let disposePromise: Promise<void> | undefined
    // Why: a live-child failure usually surfaces as an `error` event followed by
    // an `exit`. Emit exactly one overflow refresh across both so the renderer
    // isn't asked to re-read twice for a single crash.
    let crashReported = false

    const reportLiveCrash = (context: Record<string, unknown>): void => {
      if (disposed || crashReported) {
        return
      }
      crashReported = true
      console.error('[runtime-files.watch] child crashed', { rootPath, ...context })
      callback([{ kind: 'overflow', absolutePath: rootPath }])
    }

    const runDispose = async (): Promise<void> => {
      if (disposed) {
        return
      }
      disposed = true
      if (exited) {
        return
      }
      // Ask the child to unsubscribe its native watcher and exit on its own.
      // Why: a force kill frees the child's V8 env while @parcel/watcher's
      // native watch thread / inflight async work is still live, which faults
      // inside napi. Only SIGKILL as a backstop if the child wedges.
      try {
        child.send({ type: 'unsubscribe' } satisfies FileWatcherHostMessage)
      } catch {
        // Child already gone — the exit wait and timeout backstop cover it.
      }
      const exitResult = await waitForChildExit(child, CHILD_TEARDOWN_TIMEOUT_MS)
      if (exitResult === 'timeout' && !exited) {
        child.kill('SIGKILL')
      }
    }

    // Why: racing dispose callers must share the same child-exit drain instead
    // of letting later calls resolve while teardown is still in flight.
    const dispose = (): Promise<void> => {
      disposePromise ??= runDispose()
      return disposePromise
    }

    child.on('message', (message: FileWatcherChildMessage) => {
      if (message.type === 'ready') {
        ready = true
        resolve(dispose)
        return
      }
      if (message.type === 'events') {
        if (!disposed) {
          callback(message.events)
        }
        return
      }
      if (message.type === 'error') {
        if (!ready) {
          // The crawl never went live — fail the watch so the caller knows.
          disposed = true
          child.kill('SIGKILL')
          reject(new Error(message.message))
          return
        }
        // Already live: a mid-stream watcher error. Tell the renderer to
        // refresh; the child also emits an overflow event alongside this.
        console.error('[runtime-files.watch] child error', { rootPath, error: message.message })
      }
    })

    child.on('error', (err) => {
      if (!ready) {
        disposed = true
        // Why: an `error` on a live-but-pre-ready child (e.g. an IPC send fault)
        // leaves a running process; kill it so we don't orphan the watcher.
        child.kill('SIGKILL')
        reject(err)
        return
      }
      // A live child failed: surface an overflow so the renderer re-reads,
      // rather than silently going stale. The `exit` that follows is deduped.
      reportLiveCrash({ err })
    })

    child.on('exit', (code, signal) => {
      exited = true
      if (!ready && !disposed) {
        disposed = true
        reject(new Error(`file watcher child exited before ready (code ${code}, signal ${signal})`))
        return
      }
      // Why: a live child that exits unexpectedly — including a native
      // @parcel/watcher abort surfacing as signal SIGABRT — must not silently
      // stop refreshing the explorer. This is the crash that used to kill the
      // whole serve process (#6635); now it is contained to the child and the
      // host stays alive, so just request an overflow refresh.
      if (signal || (typeof code === 'number' && code !== 0)) {
        reportLiveCrash({ code, signal })
      }
    })
  })
}
