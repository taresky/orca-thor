/**
 * Single-flight coordinator for fs.listFiles full-tree scans (#7721).
 *
 * Why: rapid workspace switching used to stack N concurrent full-tree scans
 * on the single-threaded relay and its one SSH channel, starving small
 * interactive fs.readDir/fs.stat requests past their 30s timeout. This
 * coordinator guarantees at most one scan in flight per (client, scan key):
 *   - a request for the same root/excludes joins the in-flight scan
 *     (Quick Open + file-explorer filter share one scan),
 *   - a request for a DIFFERENT root/excludes runs as its own concurrent
 *     single-flight scan. Why #7769: two independent callers on one SSH
 *     connection — e.g. the editor's markdown-document scan (no excludes) and
 *     Quick Open (nested-worktree excludes) — share one relay clientId. Keying
 *     only by clientId let a newer request supersede an older unrelated one,
 *     surfacing a spurious "superseded"/empty-list failure to a caller that
 *     never cancelled. Abandoned scans are still stopped via their requester's
 *     rpc.cancel (see attach below), not by evicting a sibling caller,
 *   - when every joined requester cancels (rpc.cancel / client detach), the
 *     scan is aborted so abandoned work stops immediately.
 */
import { fileListingCancellationError } from '../shared/file-listing-cancellation'

type ScanEntry = {
  key: string
  controller: AbortController
  promise: Promise<string[]>
  attachedCount: number
}

export class ListFilesScanCoordinator {
  private readonly scansByClient = new Map<number, Map<string, ScanEntry>>()

  run(opts: {
    clientId: number
    key: string
    signal?: AbortSignal
    start: (signal: AbortSignal) => Promise<string[]>
  }): Promise<string[]> {
    const { clientId, key, signal, start } = opts
    if (signal?.aborted) {
      return Promise.reject(fileListingCancellationError(signal))
    }

    let byKey = this.scansByClient.get(clientId)
    const existing = byKey?.get(key)
    if (existing && !existing.controller.signal.aborted) {
      return this.attach(existing, signal)
    }
    if (!byKey) {
      byKey = new Map<string, ScanEntry>()
      this.scansByClient.set(clientId, byKey)
    }

    const controller = new AbortController()
    const entry: ScanEntry = {
      key,
      controller,
      promise: Promise.resolve([]),
      attachedCount: 0
    }
    byKey.set(key, entry)
    entry.promise = start(controller.signal).finally(() => {
      const scans = this.scansByClient.get(clientId)
      if (scans?.get(key) === entry) {
        scans.delete(key)
        if (scans.size === 0) {
          this.scansByClient.delete(clientId)
        }
      }
    })
    return this.attach(entry, signal)
  }

  private attach(entry: ScanEntry, signal?: AbortSignal): Promise<string[]> {
    entry.attachedCount++
    if (!signal) {
      return entry.promise
    }
    // Why: an aborting requester must see its own cancellation even though
    // the shared scan keeps running (and may later resolve) for coalesced
    // siblings — so each attachment gets its own promise.
    return new Promise<string[]>((resolve, reject) => {
      let settled = false
      const settle = (complete: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        complete()
      }
      const onAbort = (): void =>
        settle(() => {
          entry.attachedCount--
          const cancellation = fileListingCancellationError(signal)
          // Why: only stop the shared scan when nobody is left waiting on it —
          // one requester cancelling must not break a coalesced sibling.
          if (entry.attachedCount <= 0) {
            entry.controller.abort(cancellation)
          }
          reject(cancellation)
        })
      signal.addEventListener('abort', onAbort, { once: true })
      entry.promise.then(
        (files) => settle(() => resolve(files)),
        (error) => settle(() => reject(error))
      )
    })
  }
}
