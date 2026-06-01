/* eslint-disable max-lines -- Resource mirror behavior spans symlink, copy,
ownership, and stale-cleanup cases that need shared fs mocks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'

const { getPathMock, homedirMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>(),
  homedirMock: vi.fn<() => string>()
}))

const { fsMockState } = vi.hoisted(() => ({
  fsMockState: {
    failSymlink: false,
    readlinkOverrides: new Map<string, string>()
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  return {
    ...actual,
    readlinkSync: (...args: Parameters<typeof actual.readlinkSync>) => {
      const override = fsMockState.readlinkOverrides.get(String(args[0]))
      if (override !== undefined) {
        return override
      }
      return actual.readlinkSync(...args)
    },
    symlinkSync: (...args: Parameters<typeof actual.symlinkSync>) => {
      if (fsMockState.failSymlink) {
        throw new Error('symlink disabled for test')
      }
      return actual.symlinkSync(...args)
    }
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return {
    ...actual,
    homedir: homedirMock
  }
})

import {
  syncCodexResourcesIntoHome,
  syncSystemCodexResourcesIntoManagedHome
} from './codex-home-paths'

let fakeHomeDir: string
let userDataDir: string
let previousUserDataPath: string | undefined

function getSystemCodexHomePath(): string {
  return join(fakeHomeDir, '.codex')
}

function getRuntimeCodexHomePath(): string {
  return join(userDataDir, 'codex-runtime-home', 'home')
}

function normalizeLinkTarget(linkTarget: string): string {
  return process.platform === 'win32'
    ? linkTarget.replace(/^\\\\\?\\/, '').toLowerCase()
    : linkTarget
}

function expectSymbolicLinkTargetIfLinked(targetPath: string, sourcePath: string): void {
  if (!lstatSync(targetPath).isSymbolicLink()) {
    return
  }
  expect(normalizeLinkTarget(readlinkSync(targetPath))).toBe(normalizeLinkTarget(sourcePath))
}

function mockElectronAppPaths(): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: getPathMock
    }
  }))
}

beforeEach(() => {
  mockElectronAppPaths()
  fsMockState.failSymlink = false
  fsMockState.readlinkOverrides.clear()
  fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-codex-resource-home-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-codex-resource-user-data-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = userDataDir
  homedirMock.mockReturnValue(fakeHomeDir)
  getPathMock.mockImplementation((name: string) => {
    if (name === 'userData') {
      return userDataDir
    }
    throw new Error(`unexpected app.getPath(${name})`)
  })
  mkdirSync(getSystemCodexHomePath(), { recursive: true })
})

afterEach(() => {
  rmSync(fakeHomeDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  vi.clearAllMocks()
})

describe('syncSystemCodexResourcesIntoManagedHome', () => {
  it('uses ORCA_USER_DATA_PATH when Electron cannot be required', async () => {
    vi.resetModules()
    vi.doMock('electron', () => {
      throw new Error('electron unavailable in packaged CLI')
    })
    const previousUserDataPath = process.env.ORCA_USER_DATA_PATH
    process.env.ORCA_USER_DATA_PATH = userDataDir
    try {
      const { getOrcaManagedCodexHomePath: getCliSafeManagedPath } =
        await import('./codex-home-paths')

      expect(getCliSafeManagedPath()).toBe(join(userDataDir, 'codex-runtime-home', 'home'))
    } finally {
      if (previousUserDataPath === undefined) {
        delete process.env.ORCA_USER_DATA_PATH
      } else {
        process.env.ORCA_USER_DATA_PATH = previousUserDataPath
      }
      mockElectronAppPaths()
      vi.resetModules()
    }
  })

  it('mirrors only user resource entries into the managed runtime home', () => {
    mkdirSync(join(getSystemCodexHomePath(), 'skills', 'review'), { recursive: true })
    mkdirSync(join(getSystemCodexHomePath(), 'plugins'), { recursive: true })
    mkdirSync(join(getSystemCodexHomePath(), 'sessions'), { recursive: true })
    writeFileSync(join(getSystemCodexHomePath(), 'skills', 'review', 'SKILL.md'), 'skill\n')
    writeFileSync(join(getSystemCodexHomePath(), 'plugins', 'plugin.json'), '{}\n')
    writeFileSync(join(getSystemCodexHomePath(), 'auth.json'), '{"account":"system"}\n')
    writeFileSync(join(getSystemCodexHomePath(), 'hooks.json'), '{"hooks":{}}\n')
    writeFileSync(join(getSystemCodexHomePath(), 'history.jsonl'), '{}\n')

    syncSystemCodexResourcesIntoManagedHome()

    const runtimeSkillsPath = join(getRuntimeCodexHomePath(), 'skills')
    const runtimePluginsPath = join(getRuntimeCodexHomePath(), 'plugins')
    expect(readFileSync(join(runtimeSkillsPath, 'review', 'SKILL.md'), 'utf-8')).toBe('skill\n')
    expect(readFileSync(join(runtimePluginsPath, 'plugin.json'), 'utf-8')).toBe('{}\n')
    expectSymbolicLinkTargetIfLinked(runtimeSkillsPath, join(getSystemCodexHomePath(), 'skills'))
    expect(existsSync(join(getRuntimeCodexHomePath(), 'sessions'))).toBe(false)
    expect(existsSync(join(getRuntimeCodexHomePath(), 'auth.json'))).toBe(false)
    expect(existsSync(join(getRuntimeCodexHomePath(), 'hooks.json'))).toBe(false)
    expect(existsSync(join(getRuntimeCodexHomePath(), 'history.jsonl'))).toBe(false)
  })

  it('does not replace an existing runtime-owned resource entry', () => {
    mkdirSync(join(getSystemCodexHomePath(), 'skills'), { recursive: true })
    mkdirSync(join(getRuntimeCodexHomePath(), 'skills'), { recursive: true })
    writeFileSync(join(getSystemCodexHomePath(), 'skills', 'system.md'), 'system\n')
    writeFileSync(join(getRuntimeCodexHomePath(), 'skills', 'runtime.md'), 'runtime\n')

    syncSystemCodexResourcesIntoManagedHome()

    const runtimeSkillsPath = join(getRuntimeCodexHomePath(), 'skills')
    expect(lstatSync(runtimeSkillsPath).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(runtimeSkillsPath, 'runtime.md'), 'utf-8')).toBe('runtime\n')
    expect(existsSync(join(runtimeSkillsPath, 'system.md'))).toBe(false)
  })

  it('removes owned symlinks for deleted system resources without touching unrelated runtime links', () => {
    const systemSkillsPath = join(getSystemCodexHomePath(), 'skills')
    const runtimeSkillsPath = join(getRuntimeCodexHomePath(), 'skills')
    const externalPluginsPath = join(userDataDir, 'external-plugins')
    const runtimePluginsPath = join(getRuntimeCodexHomePath(), 'plugins')
    mkdirSync(systemSkillsPath, { recursive: true })
    mkdirSync(externalPluginsPath, { recursive: true })
    mkdirSync(getRuntimeCodexHomePath(), { recursive: true })
    writeFileSync(join(systemSkillsPath, 'system.md'), 'system\n')
    writeFileSync(join(externalPluginsPath, 'runtime.md'), 'runtime\n')
    symlinkSync(
      externalPluginsPath,
      runtimePluginsPath,
      process.platform === 'win32' ? 'junction' : undefined
    )

    syncSystemCodexResourcesIntoManagedHome()
    expect(lstatSync(runtimeSkillsPath).isSymbolicLink()).toBe(true)
    expectSymbolicLinkTargetIfLinked(runtimeSkillsPath, systemSkillsPath)

    rmSync(systemSkillsPath, { recursive: true, force: true })
    syncSystemCodexResourcesIntoManagedHome()

    expect(() => lstatSync(runtimeSkillsPath)).toThrow()
    expect(lstatSync(runtimePluginsPath).isSymbolicLink()).toBe(true)
    expectSymbolicLinkTargetIfLinked(runtimePluginsPath, externalPluginsPath)
    expect(readFileSync(join(runtimePluginsPath, 'runtime.md'), 'utf-8')).toBe('runtime\n')
  })

  it('recognizes Windows extended UNC resource links as owned', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const sourceHomePath = '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.codex'
    const targetHomePath = getRuntimeCodexHomePath()
    const targetSkillsPath = join(targetHomePath, 'skills')
    const placeholderSourcePath = join(fakeHomeDir, 'placeholder-skills')
    mkdirSync(placeholderSourcePath, { recursive: true })
    mkdirSync(targetHomePath, { recursive: true })
    symlinkSync(placeholderSourcePath, targetSkillsPath, 'junction')
    fsMockState.readlinkOverrides.set(
      targetSkillsPath,
      '\\\\?\\UNC\\wsl.localhost\\Ubuntu\\home\\alice\\.codex\\skills'
    )

    try {
      syncCodexResourcesIntoHome(sourceHomePath, targetHomePath)

      expect(() => lstatSync(targetSkillsPath)).toThrow()
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('recognizes Linux readlink targets for WSL UNC resource links as owned', () => {
    const sourceHomePath = '\\\\wsl.localhost\\Ubuntu\\home\\alice\\.codex'
    const targetHomePath = getRuntimeCodexHomePath()
    const targetSkillsPath = join(targetHomePath, 'skills')
    const placeholderSourcePath = join(fakeHomeDir, 'placeholder-skills')
    mkdirSync(placeholderSourcePath, { recursive: true })
    mkdirSync(targetHomePath, { recursive: true })
    symlinkSync(placeholderSourcePath, targetSkillsPath)
    fsMockState.readlinkOverrides.set(targetSkillsPath, '/home/alice/.codex/skills')

    syncCodexResourcesIntoHome(sourceHomePath, targetHomePath)

    expect(() => lstatSync(targetSkillsPath)).toThrow()
  })

  it('refreshes owned fallback copies when symlinks are unavailable', () => {
    fsMockState.failSymlink = true
    const systemProfilePath = join(getSystemCodexHomePath(), 'profile-v2')
    const runtimeProfilePath = join(getRuntimeCodexHomePath(), 'profile-v2')
    writeFileSync(systemProfilePath, 'first\n', 'utf-8')

    syncSystemCodexResourcesIntoManagedHome()
    writeFileSync(systemProfilePath, 'second\n', 'utf-8')
    syncSystemCodexResourcesIntoManagedHome()

    expect(lstatSync(runtimeProfilePath).isSymbolicLink()).toBe(false)
    expect(readFileSync(runtimeProfilePath, 'utf-8')).toBe('second\n')
  })

  it('mirrors resources from explicit source and target homes', () => {
    const sourceHomePath = join(fakeHomeDir, 'source-codex')
    const targetHomePath = join(userDataDir, 'target-codex')
    mkdirSync(join(sourceHomePath, 'prompts'), { recursive: true })
    writeFileSync(join(sourceHomePath, 'prompts', 'review.md'), 'prompt\n', 'utf-8')
    writeFileSync(join(sourceHomePath, 'auth.json'), '{"account":"ignored"}\n', 'utf-8')

    syncCodexResourcesIntoHome(sourceHomePath, targetHomePath)

    const targetPromptsPath = join(targetHomePath, 'prompts')
    expect(readFileSync(join(targetPromptsPath, 'review.md'), 'utf-8')).toBe('prompt\n')
    expectSymbolicLinkTargetIfLinked(targetPromptsPath, join(sourceHomePath, 'prompts'))
    expect(existsSync(join(targetHomePath, 'auth.json'))).toBe(false)
  })

  it('skips unchanged fallback copies and refreshes changed files', () => {
    fsMockState.failSymlink = true
    const systemProfilePath = join(getSystemCodexHomePath(), 'profile-v2')
    const runtimeProfilePath = join(getRuntimeCodexHomePath(), 'profile-v2')
    writeFileSync(systemProfilePath, 'first\n', 'utf-8')

    syncSystemCodexResourcesIntoManagedHome()
    writeFileSync(runtimeProfilePath, 'runtime edit\n', 'utf-8')
    syncSystemCodexResourcesIntoManagedHome()

    expect(readFileSync(runtimeProfilePath, 'utf-8')).toBe('runtime edit\n')

    writeFileSync(systemProfilePath, 'changed source\n', 'utf-8')
    syncSystemCodexResourcesIntoManagedHome()

    expect(readFileSync(runtimeProfilePath, 'utf-8')).toBe('changed source\n')
  })

  it('refreshes fallback copies for same-size source edits with unchanged mtime', () => {
    fsMockState.failSymlink = true
    const systemProfilePath = join(getSystemCodexHomePath(), 'profile-v2')
    const runtimeProfilePath = join(getRuntimeCodexHomePath(), 'profile-v2')
    const fixedTime = new Date('2026-01-01T00:00:00.000Z')
    writeFileSync(systemProfilePath, 'aaaa\n', 'utf-8')
    utimesSync(systemProfilePath, fixedTime, fixedTime)

    syncSystemCodexResourcesIntoManagedHome()
    writeFileSync(systemProfilePath, 'bbbb\n', 'utf-8')
    utimesSync(systemProfilePath, fixedTime, fixedTime)
    syncSystemCodexResourcesIntoManagedHome()

    expect(readFileSync(runtimeProfilePath, 'utf-8')).toBe('bbbb\n')
  })

  it('refreshes fallback directory copies when nested source entries change', () => {
    fsMockState.failSymlink = true
    const systemSkillPath = join(getSystemCodexHomePath(), 'skills', 'review')
    const runtimeSkillFilePath = join(getRuntimeCodexHomePath(), 'skills', 'review', 'SKILL.md')
    mkdirSync(systemSkillPath, { recursive: true })
    writeFileSync(join(systemSkillPath, 'SKILL.md'), 'first\n', 'utf-8')

    syncSystemCodexResourcesIntoManagedHome()
    writeFileSync(runtimeSkillFilePath, 'runtime edit\n', 'utf-8')
    syncSystemCodexResourcesIntoManagedHome()

    expect(readFileSync(runtimeSkillFilePath, 'utf-8')).toBe('runtime edit\n')

    writeFileSync(join(systemSkillPath, 'SKILL.md'), 'nested source changed\n', 'utf-8')
    syncSystemCodexResourcesIntoManagedHome()

    expect(readFileSync(runtimeSkillFilePath, 'utf-8')).toBe('nested source changed\n')
  })

  it('dereferences nested symlinks when fallback-copying resources', () => {
    const systemSkillPath = join(getSystemCodexHomePath(), 'skills', 'review')
    const linkedSkillPath = join(fakeHomeDir, 'linked-skill.md')
    mkdirSync(systemSkillPath, { recursive: true })
    writeFileSync(linkedSkillPath, 'linked skill\n', 'utf-8')
    symlinkSync(linkedSkillPath, join(systemSkillPath, 'SKILL.md'))
    fsMockState.failSymlink = true

    syncSystemCodexResourcesIntoManagedHome()

    const runtimeSkillFilePath = join(getRuntimeCodexHomePath(), 'skills', 'review', 'SKILL.md')
    expect(lstatSync(runtimeSkillFilePath).isSymbolicLink()).toBe(false)
    expect(readFileSync(runtimeSkillFilePath, 'utf-8')).toBe('linked skill\n')
  })

  it('refreshes fallback copies when symlinked directory contents change', () => {
    const systemSkillsPath = join(getSystemCodexHomePath(), 'skills')
    const linkedSkillDir = join(fakeHomeDir, 'linked-review-skill')
    const runtimeSkillFilePath = join(getRuntimeCodexHomePath(), 'skills', 'review', 'SKILL.md')
    mkdirSync(systemSkillsPath, { recursive: true })
    mkdirSync(linkedSkillDir, { recursive: true })
    writeFileSync(join(linkedSkillDir, 'SKILL.md'), 'first linked skill\n', 'utf-8')
    symlinkSync(linkedSkillDir, join(systemSkillsPath, 'review'))
    fsMockState.failSymlink = true

    syncSystemCodexResourcesIntoManagedHome()
    writeFileSync(join(linkedSkillDir, 'SKILL.md'), 'second linked skill\n', 'utf-8')
    syncSystemCodexResourcesIntoManagedHome()

    expect(lstatSync(join(getRuntimeCodexHomePath(), 'skills', 'review')).isSymbolicLink()).toBe(
      false
    )
    expect(readFileSync(runtimeSkillFilePath, 'utf-8')).toBe('second linked skill\n')
  })
})
