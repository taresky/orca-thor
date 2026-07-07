import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { FileWithMtime } from './session-scanner-types'

// Sized past the remote recency cap (1000) plus the in-scope parse cap (2000)
// so a full steady-state result set stays resident between rescans; matches
// the local session-scanner-parse-cache bound.
export const REMOTE_PARSE_CACHE_MAX_ENTRIES_PER_HOST = 4096

type RemoteSessionParseCacheEntry = {
  mtimeMs: number
  sizeBytes: number | null
  session: AiVaultSession | null
}

export type RemoteSessionParseCacheHit = {
  session: AiVaultSession | null
}

// Keyed by execution host so identical remote paths on different hosts can
// never serve each other's sessions. Reconnects keep entries (paths and
// mtimes stay valid); target removal evicts via evictRemoteSessionParseCache.
const cacheByHost = new Map<ExecutionHostId, Map<string, RemoteSessionParseCacheEntry>>()

/**
 * Return the parse result cached for this remote file when its (mtime, size)
 * stat is unchanged, refreshing its LRU recency. A hit means the rescan skips
 * the SSH body transfer and re-parse entirely; `null` means read + parse.
 */
export function readCachedRemoteSessionParse(
  executionHostId: ExecutionHostId,
  file: FileWithMtime
): RemoteSessionParseCacheHit | null {
  const hostCache = cacheByHost.get(executionHostId)
  const entry = hostCache?.get(file.path)
  if (!hostCache || !entry) {
    return null
  }
  const unchanged =
    entry.mtimeMs === file.mtimeMs &&
    (entry.sizeBytes === null || file.sizeBytes === undefined || entry.sizeBytes === file.sizeBytes)
  if (!unchanged) {
    return null
  }
  hostCache.delete(file.path)
  hostCache.set(file.path, entry)
  return { session: entry.session }
}

export function storeRemoteSessionParse(
  executionHostId: ExecutionHostId,
  file: FileWithMtime,
  session: AiVaultSession | null
): void {
  let hostCache = cacheByHost.get(executionHostId)
  if (!hostCache) {
    hostCache = new Map()
    cacheByHost.set(executionHostId, hostCache)
  }
  hostCache.delete(file.path)
  hostCache.set(file.path, {
    mtimeMs: file.mtimeMs,
    sizeBytes: file.sizeBytes ?? null,
    session
  })
  if (hostCache.size > REMOTE_PARSE_CACHE_MAX_ENTRIES_PER_HOST) {
    const oldest = hostCache.keys().next()
    if (!oldest.done) {
      hostCache.delete(oldest.value)
    }
  }
}

export function evictRemoteSessionParseCache(executionHostId: ExecutionHostId): void {
  cacheByHost.delete(executionHostId)
}

export function resetRemoteSessionParseCacheForTests(): void {
  cacheByHost.clear()
}
