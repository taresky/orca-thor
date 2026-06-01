import { dirname, join, win32 as pathWin32 } from 'node:path'
import { parseWslUncPath } from '../../shared/wsl-paths'

export function joinWslCodexPath(basePath: string, ...segments: string[]): string {
  return parseWslUncPath(basePath)
    ? pathWin32.join(basePath, ...segments)
    : join(basePath, ...segments)
}

export function getWslCodexRuntimeHomePath(wslHome: string): string {
  return joinWslCodexPath(wslHome, '.local', 'share', 'orca', 'codex-runtime-home', 'home')
}

export function getWslCodexRuntimeRootPathFromRuntimeHome(runtimeHomePath: string): string {
  return getWslCodexDirname(runtimeHomePath)
}

export function getWslCodexLaunchRootPathFromRuntimeHome(runtimeHomePath: string): string {
  return joinWslCodexPath(
    getWslCodexRuntimeRootPathFromRuntimeHome(runtimeHomePath),
    'launch',
    'wsl'
  )
}

export function getWslCodexActiveHomePathFromRuntimeHome(runtimeHomePath: string): string {
  return joinWslCodexPath(
    getWslCodexRuntimeRootPathFromRuntimeHome(runtimeHomePath),
    'active',
    'wsl',
    'home'
  )
}

function getWslCodexDirname(path: string): string {
  return parseWslUncPath(path) ? pathWin32.dirname(path) : dirname(path)
}
