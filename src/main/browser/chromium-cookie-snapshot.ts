import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SNAPSHOT_ATTEMPTS = 5
// Why: continuous Chromium writers can keep all immediate retries inside one
// write burst; a short pause lets the burst settle without making import laggy.
const SNAPSHOT_RETRY_BACKOFF_MS = 25

type FileState = {
  device: bigint
  inode: bigint
  size: bigint
  modifiedAt: bigint
  changedAt: bigint
}

export type ChromiumCookieSnapshot = {
  databasePath: string
  cleanup: () => void
}

type ChromiumCookieSnapshotOptions = {
  /** Prefer a private app path (e.g. userData); tests inject an isolated root. */
  tempRoot?: string
  /** Delay between failed snapshot attempts. Defaults to 25ms. */
  retryBackoffMs?: number
  /** Injectable sleep for tests; defaults to portable Atomics.wait sleep. */
  sleep?: (ms: number) => void
}

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return
  }
  // Why: keep createChromiumCookieSnapshot synchronous for the import pipeline;
  // Atomics.wait is the portable bounded sleep without child_process/platform tools.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function removeSnapshotDirectory(path: string): void {
  // Why: Windows can briefly retain SQLite handles after close; bounded retries
  // keep cleanup reliable without ever touching the live browser directory.
  rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function readFileState(path: string): FileState | null {
  try {
    const stats = statSync(path, { bigint: true })
    return {
      device: stats.dev,
      inode: stats.ino,
      size: stats.size,
      modifiedAt: stats.mtimeNs,
      changedAt: stats.ctimeNs
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

function sameFileState(left: FileState | null, right: FileState | null): boolean {
  // Why: mtime/ctime equality is coarse FS stability only; concurrent writers that
  // finish within the same timestamp quantum can still pass. Retries + backoff
  // shrink that window but cannot eliminate it without content hashing.
  if (!left || !right) {
    return left === right
  }
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.changedAt === right.changedAt
  )
}

function removeAttemptFiles(databasePath: string): void {
  for (const suffix of ['', '-wal', '-shm'] as const) {
    try {
      unlinkSync(databasePath + suffix)
    } catch {
      /* best-effort between snapshot attempts */
    }
  }
}

function copyStableAttempt(sourcePath: string, databasePath: string): boolean {
  const sourceWalPath = `${sourcePath}-wal`
  const databaseBefore = readFileState(sourcePath)
  const walBefore = readFileState(sourceWalPath)
  if (!databaseBefore) {
    throw new Error('Chromium cookies database does not exist')
  }

  removeAttemptFiles(databasePath)
  copyFileSync(sourcePath, databasePath)

  if (walBefore) {
    try {
      // Why: SQLite only discovers a WAL whose basename exactly matches the DB.
      copyFileSync(sourceWalPath, `${databasePath}-wal`)
    } catch (error) {
      if (isMissingFileError(error)) {
        return false
      }
      throw error
    }
  }
  // Why: SHM is a transient mmap WAL index that may be locked or mid-update.
  // SQLite safely rebuilds a matching Cookies-shm beside the private WAL copy.

  const databaseAfter = readFileState(sourcePath)
  const walAfter = readFileState(sourceWalPath)
  if (!sameFileState(databaseBefore, databaseAfter) || !sameFileState(walBefore, walAfter)) {
    return false
  }

  const copiedDatabase = readFileState(databasePath)
  const copiedWal = readFileState(`${databasePath}-wal`)
  return (
    copiedDatabase?.size === databaseBefore.size &&
    (walBefore ? copiedWal?.size === walBefore.size : copiedWal === null)
  )
}

export function createChromiumCookieSnapshot(
  sourcePath: string,
  options: ChromiumCookieSnapshotOptions = {}
): ChromiumCookieSnapshot {
  // Why: cookie DB bytes are sensitive; production passes userData via tempRoot.
  // Fall back to os.tmpdir() so unit tests can import this module without Electron.
  const tempRoot = options.tempRoot ?? tmpdir()
  mkdirSync(tempRoot, { recursive: true })
  const snapshotDir = mkdtempSync(join(tempRoot, 'orca-cookie-import-'))
  const databasePath = join(snapshotDir, 'Cookies')
  let keepSnapshot = false
  const sleep = options.sleep ?? sleepSync
  const backoffMs = options.retryBackoffMs ?? SNAPSHOT_RETRY_BACKOFF_MS

  try {
    for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        sleep(backoffMs)
      }
      if (copyStableAttempt(sourcePath, databasePath)) {
        keepSnapshot = true
        return {
          databasePath,
          cleanup: () => removeSnapshotDirectory(snapshotDir)
        }
      }
    }
    throw new Error('Chromium cookies database changed while creating a snapshot')
  } finally {
    if (!keepSnapshot) {
      try {
        removeSnapshotDirectory(snapshotDir)
      } catch {
        // Why: cleanup must not replace the original snapshot failure for the caller.
      }
    }
  }
}
