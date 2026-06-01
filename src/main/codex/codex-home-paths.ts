/* eslint-disable max-lines -- Why: resource mirroring keeps ownership markers,
symlink fallback, and recursive fingerprints together so host and WSL behavior
does not drift. */
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import type { Stats } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseWslUncPath } from '../../shared/wsl-paths'

const CODEX_SYSTEM_RESOURCE_ENTRIES = [
  'skills',
  'plugins',
  'plugin-state',
  'profile-v2',
  'themes',
  'prompts'
] as const

type ResourceFingerprint = {
  kind: ResourceKind
  size: number
  mtimeMs: number
  contentDigest?: string
  entries?: ResourceFingerprintEntry[]
  linkTarget?: string
  targetFingerprint?: ResourceFingerprint
}

type ResourceFingerprintEntry = ResourceFingerprint & {
  relativePath: string
}

type ResourceKind = 'directory' | 'file' | 'symlink' | 'other'

type CopiedResourceMarker = {
  sourcePath: string
  sourceFingerprint?: ResourceFingerprint
}

const warnedResourceConflictKeys = new Set<string>()

export function getSystemCodexHomePath(): string {
  return join(homedir(), '.codex')
}

export function getOrcaManagedCodexHomePath(): string {
  const managedHomePath = join(getOrcaUserDataPath(), 'codex-runtime-home', 'home')
  mkdirSync(managedHomePath, { recursive: true })
  return managedHomePath
}

function getOrcaUserDataPath(): string {
  if (process.env.ORCA_USER_DATA_PATH) {
    return process.env.ORCA_USER_DATA_PATH
  }
  // Why: CLI hook commands import this module outside Electron. Mirror the CLI
  // runtime metadata path so offline hook status/on/off uses the same userData.
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'orca')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'orca')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'orca')
}

export function syncSystemCodexResourcesIntoManagedHome(): void {
  const systemHomePath = getSystemCodexHomePath()
  const managedHomePath = getOrcaManagedCodexHomePath()
  syncCodexResourcesIntoHome(systemHomePath, managedHomePath)
}

export function syncCodexResourcesIntoHome(sourceHomePath: string, targetHomePath: string): void {
  for (const entryName of CODEX_SYSTEM_RESOURCE_ENTRIES) {
    try {
      linkCodexResource(sourceHomePath, targetHomePath, entryName)
    } catch (error) {
      console.warn('[codex-home] Failed to sync Codex resource:', entryName, error)
    }
  }
}

function linkCodexResource(
  sourceHomePath: string,
  targetHomePath: string,
  entryName: string
): void {
  const sourcePath = join(sourceHomePath, entryName)
  const targetPath = join(targetHomePath, entryName)
  if (!existsSync(sourcePath)) {
    removeCopiedResourceIfOwned(targetPath, targetHomePath, entryName, sourcePath)
    return
  }

  if (targetAlreadyPointsToSource(targetPath, sourcePath)) {
    clearCopiedResourceMarker(targetHomePath, entryName)
    return
  }
  const sourceFingerprint = getResourceFingerprint(sourcePath)
  const shouldRefreshFallbackCopy = targetIsOwnedFallbackCopy(
    targetPath,
    targetHomePath,
    entryName,
    sourcePath
  )
    ? copiedResourceNeedsRefresh(targetHomePath, entryName, sourcePath, sourceFingerprint)
    : false
  if (existsSync(targetPath) && !shouldRefreshFallbackCopy) {
    warnIfRuntimeResourceBlocksMirror(targetHomePath, entryName, sourcePath)
    return
  }
  if (shouldRefreshFallbackCopy) {
    rmSync(targetPath, { recursive: true, force: true })
  }

  try {
    const sourceStat = lstatSync(sourcePath)
    symlinkSync(
      sourcePath,
      targetPath,
      sourceStat.isDirectory() && process.platform === 'win32' ? 'junction' : undefined
    )
    clearCopiedResourceMarker(targetHomePath, entryName)
  } catch (error) {
    try {
      rmSync(targetPath, { recursive: true, force: true })
      // Why: Windows can reject file symlinks outside developer mode. Copy is
      // a fallback for launch-time resources; mark ownership so later syncs can
      // refresh the copy without touching user-created runtime resources.
      cpSync(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: true
      })
      dereferenceCopiedSymlinks(targetPath)
      markCopiedResource(targetHomePath, entryName, sourcePath, sourceFingerprint)
    } catch {
      console.warn('[codex-home] Failed to link Codex resource:', entryName, error)
    }
  }
}

function dereferenceCopiedSymlinks(targetPath: string): void {
  const targetStat = lstatSync(targetPath)
  if (targetStat.isSymbolicLink()) {
    const realPath = realpathSync(targetPath)
    rmSync(targetPath, { recursive: true, force: true })
    cpSync(realPath, targetPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: true
    })
    dereferenceCopiedSymlinks(targetPath)
    return
  }
  if (!targetStat.isDirectory()) {
    return
  }
  for (const entry of readdirSync(targetPath)) {
    dereferenceCopiedSymlinks(join(targetPath, entry))
  }
}

function warnIfRuntimeResourceBlocksMirror(
  targetHomePath: string,
  entryName: string,
  sourcePath: string
): void {
  const marker = readCopiedResourceMarker(targetHomePath, entryName)
  if (marker?.sourcePath === sourcePath) {
    return
  }
  const warnKey = `${entryName}\0${sourcePath}`
  if (warnedResourceConflictKeys.has(warnKey)) {
    return
  }
  warnedResourceConflictKeys.add(warnKey)
  console.warn(
    '[codex-home] Runtime Codex resource blocks mirrored system resource:',
    entryName,
    sourcePath
  )
}

function targetAlreadyPointsToSource(targetPath: string, sourcePath: string): boolean {
  try {
    return (
      lstatSync(targetPath).isSymbolicLink() &&
      linkTargetsMatch(readlinkSync(targetPath), sourcePath)
    )
  } catch {
    return false
  }
}

function linkTargetsMatch(actualTarget: string, expectedTarget: string): boolean {
  const expectedWsl = parseWslUncPath(expectedTarget)
  if (expectedWsl && actualTarget === expectedWsl.linuxPath) {
    return true
  }
  if (process.platform !== 'win32') {
    return actualTarget === expectedTarget
  }
  return normalizeWindowsLinkTarget(actualTarget) === normalizeWindowsLinkTarget(expectedTarget)
}

function normalizeWindowsLinkTarget(linkTarget: string): string {
  return linkTarget
    .replace(/\//g, '\\')
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '')
    .toLowerCase()
}

function getResourceCopyMarkerPath(managedHomePath: string, entryName: string): string {
  return join(managedHomePath, '.orca-resource-copies', `${entryName}.json`)
}

function markCopiedResource(
  targetHomePath: string,
  entryName: string,
  sourcePath: string,
  sourceFingerprint: ResourceFingerprint
): void {
  const markerPath = getResourceCopyMarkerPath(targetHomePath, entryName)
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${JSON.stringify({ sourcePath, sourceFingerprint }, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function readCopiedResourceMarker(
  targetHomePath: string,
  entryName: string
): CopiedResourceMarker | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(getResourceCopyMarkerPath(targetHomePath, entryName), 'utf-8')
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const sourcePath = 'sourcePath' in parsed ? parsed.sourcePath : null
    if (typeof sourcePath !== 'string') {
      return null
    }
    const sourceFingerprint =
      'sourceFingerprint' in parsed && isResourceFingerprint(parsed.sourceFingerprint)
        ? parsed.sourceFingerprint
        : undefined
    return { sourcePath, sourceFingerprint }
  } catch {
    return null
  }
}

function isResourceFingerprint(value: unknown): value is ResourceFingerprint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<ResourceFingerprint>
  return (
    isResourceKind(candidate.kind) &&
    typeof candidate.size === 'number' &&
    typeof candidate.mtimeMs === 'number' &&
    (candidate.contentDigest === undefined || typeof candidate.contentDigest === 'string') &&
    (candidate.entries === undefined || Array.isArray(candidate.entries)) &&
    (candidate.linkTarget === undefined || typeof candidate.linkTarget === 'string') &&
    (candidate.targetFingerprint === undefined ||
      isResourceFingerprint(candidate.targetFingerprint))
  )
}

function isResourceKind(value: unknown): value is ResourceKind {
  return value === 'directory' || value === 'file' || value === 'symlink' || value === 'other'
}

function clearCopiedResourceMarker(managedHomePath: string, entryName: string): void {
  rmSync(getResourceCopyMarkerPath(managedHomePath, entryName), { force: true })
}

function targetIsOwnedFallbackCopy(
  targetPath: string,
  targetHomePath: string,
  entryName: string,
  sourcePath: string
): boolean {
  if (readCopiedResourceMarker(targetHomePath, entryName)?.sourcePath !== sourcePath) {
    return false
  }
  try {
    return existsSync(targetPath) && !lstatSync(targetPath).isSymbolicLink()
  } catch {
    return false
  }
}

function copiedResourceNeedsRefresh(
  targetHomePath: string,
  entryName: string,
  sourcePath: string,
  sourceFingerprint: ResourceFingerprint
): boolean {
  const marker = readCopiedResourceMarker(targetHomePath, entryName)
  if (marker?.sourcePath !== sourcePath) {
    return false
  }
  if (!marker.sourceFingerprint) {
    return true
  }
  return JSON.stringify(marker.sourceFingerprint) !== JSON.stringify(sourceFingerprint)
}

function removeCopiedResourceIfOwned(
  targetPath: string,
  managedHomePath: string,
  entryName: string,
  sourcePath: string
): void {
  if (removeSymlinkedResourceIfOwned(targetPath, sourcePath)) {
    clearCopiedResourceMarker(managedHomePath, entryName)
    return
  }
  if (!targetIsOwnedFallbackCopy(targetPath, managedHomePath, entryName, sourcePath)) {
    return
  }
  rmSync(targetPath, { recursive: true, force: true })
  clearCopiedResourceMarker(managedHomePath, entryName)
}

function getResourceFingerprint(sourcePath: string): ResourceFingerprint {
  const fingerprint = getResourceFingerprintForEntry(sourcePath)
  if (fingerprint.kind !== 'directory') {
    return fingerprint
  }
  return {
    ...fingerprint,
    entries: listDirectoryFingerprintEntries(sourcePath, sourcePath)
  }
}

function listDirectoryFingerprintEntries(
  rootPath: string,
  directoryPath: string
): ResourceFingerprintEntry[] {
  const entries: ResourceFingerprintEntry[] = []
  for (const entry of readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const entryPath = join(directoryPath, entry.name)
    const fingerprint = getResourceFingerprintForEntry(entryPath)
    entries.push({
      relativePath: entryPath.slice(rootPath.length + 1),
      ...fingerprint
    })
    if (fingerprint.kind === 'directory') {
      entries.push(...listDirectoryFingerprintEntries(rootPath, entryPath))
    }
  }
  return entries
}

function getResourceFingerprintForEntry(sourcePath: string): ResourceFingerprint {
  const stat = lstatSync(sourcePath)
  const fingerprint: ResourceFingerprint = {
    kind: getResourceKind(stat),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  }
  if (fingerprint.kind === 'file') {
    fingerprint.contentDigest = getFileDigest(sourcePath)
  }
  if (fingerprint.kind === 'symlink') {
    fingerprint.linkTarget = readlinkSync(sourcePath)
    fingerprint.targetFingerprint = getSymlinkTargetFingerprint(sourcePath)
  }
  return fingerprint
}

function getResourceKind(stat: Stats): ResourceKind {
  if (stat.isDirectory()) {
    return 'directory'
  }
  if (stat.isFile()) {
    return 'file'
  }
  if (stat.isSymbolicLink()) {
    return 'symlink'
  }
  return 'other'
}

function getFileDigest(sourcePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(sourcePath)).digest('hex')}`
}

function getSymlinkTargetFingerprint(sourcePath: string): ResourceFingerprint | undefined {
  try {
    const targetStat = statSync(sourcePath)
    const fingerprint: ResourceFingerprint = {
      kind: getResourceKind(targetStat),
      size: targetStat.size,
      mtimeMs: targetStat.mtimeMs
    }
    if (fingerprint.kind === 'file') {
      fingerprint.contentDigest = getFileDigest(sourcePath)
    }
    if (fingerprint.kind === 'directory') {
      fingerprint.entries = listDirectoryFingerprintEntries(sourcePath, sourcePath)
    }
    return fingerprint
  } catch {
    return undefined
  }
}

function removeSymlinkedResourceIfOwned(targetPath: string, sourcePath: string): boolean {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) {
      return false
    }
    if (!linkTargetsMatch(readlinkSync(targetPath), sourcePath)) {
      return false
    }
    return removeSymlinkEntry(targetPath)
  } catch {
    return false
  }
}

function removeSymlinkEntry(targetPath: string): boolean {
  try {
    // Why: recursive rm can leave a broken directory symlink behind; unlink the
    // link entry itself so deleted system resources do not linger in runtime home.
    unlinkSync(targetPath)
    return true
  } catch {
    if (process.platform !== 'win32') {
      return false
    }
  }

  try {
    rmdirSync(targetPath)
    return true
  } catch {
    return false
  }
}
