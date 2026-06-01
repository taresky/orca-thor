import { describe, expect, it } from 'vitest'
import {
  getWslCodexActiveHomePathFromRuntimeHome,
  getWslCodexLaunchRootPathFromRuntimeHome,
  getWslCodexRuntimeHomePath,
  getWslCodexRuntimeRootPathFromRuntimeHome,
  joinWslCodexPath
} from './wsl-codex-runtime-paths'

describe('wsl-codex-runtime-paths', () => {
  it('uses Windows path semantics for WSL UNC homes', () => {
    const wslHome = '\\\\wsl.localhost\\Ubuntu\\home\\alice'
    const runtimeHome = getWslCodexRuntimeHomePath(wslHome)

    expect(runtimeHome).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\codex-runtime-home\\home'
    )
    expect(getWslCodexRuntimeRootPathFromRuntimeHome(runtimeHome)).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\codex-runtime-home'
    )
    expect(getWslCodexLaunchRootPathFromRuntimeHome(runtimeHome)).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\codex-runtime-home\\launch\\wsl'
    )
    expect(getWslCodexActiveHomePathFromRuntimeHome(runtimeHome)).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\codex-runtime-home\\active\\wsl\\home'
    )
    expect(joinWslCodexPath(runtimeHome, 'config.toml')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.local\\share\\orca\\codex-runtime-home\\home\\config.toml'
    )
  })

  it('keeps POSIX path semantics for non-UNC WSL test homes', () => {
    const runtimeHome = getWslCodexRuntimeHomePath('/home/alice')

    expect(runtimeHome).toBe('/home/alice/.local/share/orca/codex-runtime-home/home')
    expect(getWslCodexLaunchRootPathFromRuntimeHome(runtimeHome)).toBe(
      '/home/alice/.local/share/orca/codex-runtime-home/launch/wsl'
    )
  })
})
