// Why: on Linux/Windows @parcel/watcher uses a brute-force backend that
// recursively walks the whole tree on a libuv threadpool thread before
// subscribe() resolves. On a huge tree backed by slow storage (a home dir on
// NFS opened as a worktree) that crawl can run for minutes. Running it here, in
// a dedicated CHILD PROCESS, keeps it off the main/`serve` process's libuv pool
// so it can never starve static-asset serving, RPC crypto, or other clients
// (issue #5308), and isolates the @parcel/watcher native addon's process-fatal
// teardown abort (`Napi::Error` -> terminate() -> SIGABRT) so it can no longer
// take down the host serve process and its in-process agent terminals. A native
// abort in a child process surfaces to the host as a catchable `exit` event; the
// same abort on a worker_thread is uncatchable and kills the whole process
// (#6635/#5377). The child owns the subscribe, the per-event stat fanout, and
// the event batching; the host only relays results.
import { stat } from 'node:fs/promises'
import type * as ParcelWatcher from '@parcel/watcher'
import type { FsChangeEvent } from '../../shared/types'

const RUNTIME_FILE_WATCH_EVENT_STAT_LIMIT = 200
const RUNTIME_FILE_WATCH_STAT_CONCURRENCY = 8

type FileWatcherChildData = {
  rootPath: string
  ignore: string[]
}

// Messages the child sends back to the host.
export type FileWatcherChildMessage =
  | { type: 'ready' }
  | { type: 'events'; events: FsChangeEvent[] }
  | { type: 'error'; message: string }

// Messages the host sends to the child.
export type FileWatcherHostMessage = { type: 'unsubscribe' }

// Why: the host passes the watch target via env rather than argv so a path with
// spaces/quotes survives the fork boundary unchanged.
const data: FileWatcherChildData = {
  rootPath: process.env.ORCA_FILE_WATCH_ROOT ?? '',
  ignore: (process.env.ORCA_FILE_WATCH_IGNORE ?? '').split('\n').filter(Boolean)
}

if (!process.send) {
  throw new Error('File watcher child must run with an IPC channel.')
}

const send = (message: FileWatcherChildMessage): void => {
  // `process.send` exists (guarded above); the callback form swallows EPIPE if
  // the host has already gone away during teardown.
  process.send?.(message, undefined, undefined, () => {})
}

/** Report a watcher failure to the host and ask the renderer to refresh from
 *  scratch (the overflow event), so a mid-stream error never leaves the
 *  explorer silently stale. */
function reportWatchError(err: unknown): void {
  send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  send({ type: 'events', events: [{ kind: 'overflow', absolutePath: data.rootPath }] })
}

/** Run an async mapper over items with a bounded number in flight at once, so a
 *  large batch can't occupy every libuv threadpool thread in this process. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length })
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function main(): Promise<void> {
  if (!data.rootPath) {
    send({ type: 'error', message: 'File watcher child started without ORCA_FILE_WATCH_ROOT.' })
    return
  }

  let watcher: typeof ParcelWatcher
  try {
    watcher = await import('@parcel/watcher')
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    return
  }

  const subscription = await watcher.subscribe(
    data.rootPath,
    (err, events) => {
      if (err) {
        reportWatchError(err)
        return
      }
      // Why: large watcher batches usually mean a generated directory or branch
      // switch. Avoid stat fanout and ask the renderer to refresh.
      if (events.length > RUNTIME_FILE_WATCH_EVENT_STAT_LIMIT) {
        send({ type: 'events', events: [{ kind: 'overflow', absolutePath: data.rootPath }] })
        return
      }
      void mapWithConcurrency(
        events,
        RUNTIME_FILE_WATCH_STAT_CONCURRENCY,
        async (event): Promise<FsChangeEvent> => {
          let isDirectory = false
          try {
            isDirectory = (await stat(event.path)).isDirectory()
          } catch {
            isDirectory = false
          }
          return { kind: event.type, absolutePath: event.path, isDirectory }
        }
      )
        .then((mapped) => {
          send({ type: 'events', events: mapped })
        })
        // Why: without this, a throwing postMessage / stat becomes an unhandled
        // rejection that crashes the child silently. Surface it instead.
        .catch((err: unknown) => reportWatchError(err))
    },
    { ignore: data.ignore }
  )

  // The crawl finished and the subscription is live.
  send({ type: 'ready' })

  process.on('message', (message: FileWatcherHostMessage) => {
    if (message.type === 'unsubscribe') {
      // Why: unsubscribe the native watcher, then exit on our own so the host
      // never has to SIGKILL us mid-teardown. If @parcel/watcher's native
      // teardown aborts here, it now only kills THIS child (a catchable host
      // `exit`), not the serve process and its agent terminals.
      void subscription
        .unsubscribe()
        .catch(() => {})
        .finally(() => {
          process.exit(0)
        })
    }
  })

  // Why: if the host's IPC channel drops (host crash/quit), tear the native
  // watcher down and exit rather than lingering as an orphan.
  process.on('disconnect', () => {
    void subscription
      .unsubscribe()
      .catch(() => {})
      .finally(() => {
        process.exit(0)
      })
  })
}

void main().catch((err: unknown) => {
  send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
})
