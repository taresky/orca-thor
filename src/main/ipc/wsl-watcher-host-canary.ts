import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WatcherBindingWatchdog } from './wsl-watcher-host-binding-watchdog'

type CanaryWatcherBinding = {
  subscribe(dir: string, callback: (error: Error | null) => void, options: object): Promise<void>
  unsubscribe(dir: string, callback: (error: Error | null) => void, options: object): Promise<void>
}

export type WslWatcherCanary = { close(): Promise<void> }

const CANARY_INTERVAL_MS = 10_000
const CANARY_EVENT_TIMEOUT_MS = 5_000
const CANARY_MAX_MISSES = 2

export async function startWslWatcherCanary(
  binding: CanaryWatcherBinding,
  watchdog: WatcherBindingWatchdog
): Promise<WslWatcherCanary> {
  const dir = mkdtempSync(join(tmpdir(), 'orca-wsl-watcher-'))
  let lastEventAt = 0
  const callback = (error: Error | null): void => {
    if (!error) {
      lastEventAt = Date.now()
    }
  }
  const options = {}
  const removeDirectory = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Temporary canary cleanup is best-effort during process exit.
    }
  }
  let clearTimers = (): void => undefined
  const cleanupOnExit = (): void => {
    clearTimers()
    removeDirectory()
  }
  // Why: process.exit from a subscribe watchdog does not unwind to the catch;
  // the temporary directory must already be owned by an exit handler.
  process.once('exit', cleanupOnExit)
  try {
    await watchdog.watch('canary subscribe', binding.subscribe(dir, callback, options))
  } catch (error) {
    process.removeListener('exit', cleanupOnExit)
    removeDirectory()
    throw error
  }
  let misses = 0
  const probes = new Set<ReturnType<typeof setTimeout>>()
  const interval = setInterval(() => {
    const probedAt = Date.now()
    try {
      writeFileSync(join(dir, 'canary.txt'), String(probedAt))
    } catch {
      return
    }
    const probe = setTimeout(() => {
      probes.delete(probe)
      if (lastEventAt >= probedAt) {
        misses = 0
      } else if (++misses >= CANARY_MAX_MISSES) {
        process.stderr.write('[wsl-watcher-host] native event delivery stalled\n')
        process.exit(2)
      }
    }, CANARY_EVENT_TIMEOUT_MS)
    probes.add(probe)
  }, CANARY_INTERVAL_MS)
  clearTimers = (): void => {
    clearInterval(interval)
    for (const probe of probes) {
      clearTimeout(probe)
    }
    probes.clear()
  }
  let closing: Promise<void> | undefined
  return {
    close: () => {
      closing ??= (async () => {
        clearTimers()
        try {
          await watchdog.watch('canary unsubscribe', binding.unsubscribe(dir, callback, options))
        } finally {
          process.removeListener('exit', cleanupOnExit)
          removeDirectory()
        }
      })()
      return closing
    }
  }
}
