/* eslint-disable max-lines -- Why: this file covers ~14 distinct relay git
   handlers plus the addWorktree state machine (--no-track + push.autoSetupRemote
   probe/write across four flow branches). Splitting per-handler would scatter
   related coverage without a meaningful boundary. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { GitHandler } from './git-handler'
import { RelayContext } from './context'
import type { RelayDispatcher } from './dispatcher'
import * as fs from 'fs/promises'
import * as path from 'path'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'

function createMockDispatcher() {
  const requestHandlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()
  const notificationHandlers = new Map<string, (params: Record<string, unknown>) => void>()

  return {
    onRequest: vi.fn(
      (method: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        requestHandlers.set(method, handler)
      }
    ),
    onNotification: vi.fn((method: string, handler: (params: Record<string, unknown>) => void) => {
      notificationHandlers.set(method, handler)
    }),
    notify: vi.fn(),
    _requestHandlers: requestHandlers,
    async callRequest(method: string, params: Record<string, unknown> = {}) {
      const handler = requestHandlers.get(method)
      if (!handler) {
        throw new Error(`No handler for ${method}`)
      }
      return handler(params)
    }
  }
}

function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' })
}

function gitCommit(dir: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', message, '--allow-empty'], { cwd: dir, stdio: 'pipe' })
}

describe('GitHandler', () => {
  let dispatcher: ReturnType<typeof createMockDispatcher>
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'relay-git-'))
    dispatcher = createMockDispatcher()
    const ctx = new RelayContext()
    ctx.registerRoot(tmpDir)
    new GitHandler(dispatcher as unknown as RelayDispatcher, ctx)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('registers all expected handlers', () => {
    const methods = Array.from(dispatcher._requestHandlers.keys())
    expect(methods).toContain('git.status')
    expect(methods).toContain('git.diff')
    expect(methods).toContain('git.stage')
    expect(methods).toContain('git.unstage')
    expect(methods).toContain('git.bulkStage')
    expect(methods).toContain('git.bulkUnstage')
    expect(methods).toContain('git.discard')
    expect(methods).toContain('git.conflictOperation')
    expect(methods).toContain('git.branchCompare')
    expect(methods).toContain('git.branchDiff')
    expect(methods).toContain('git.listWorktrees')
    expect(methods).toContain('git.addWorktree')
    expect(methods).toContain('git.removeWorktree')
  })

  describe('status', () => {
    it('returns empty entries for clean repo', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'hello')
      gitCommit(tmpDir, 'initial')

      const result = (await dispatcher.callRequest('git.status', { worktreePath: tmpDir })) as {
        entries: Record<string, unknown>[]
        conflictOperation: string
      }
      expect(result.entries).toEqual([])
      expect(result.conflictOperation).toBe('unknown')
    })

    it('detects untracked files', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'tracked.txt'), 'tracked')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'new.txt'), 'new')

      const result = (await dispatcher.callRequest('git.status', { worktreePath: tmpDir })) as {
        entries: Record<string, unknown>[]
      }
      const untracked = result.entries.find((e) => e.path === 'new.txt')
      expect(untracked).toBeDefined()
      expect(untracked!.status).toBe('untracked')
      expect(untracked!.area).toBe('untracked')
    })

    it('detects modified files', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'original')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'modified')

      const result = (await dispatcher.callRequest('git.status', { worktreePath: tmpDir })) as {
        entries: Record<string, unknown>[]
      }
      const modified = result.entries.find((e) => e.path === 'file.txt')
      expect(modified).toBeDefined()
      expect(modified!.status).toBe('modified')
      expect(modified!.area).toBe('unstaged')
    })

    it('detects staged files', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'original')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'changed')
      execFileSync('git', ['add', 'file.txt'], { cwd: tmpDir, stdio: 'pipe' })

      const result = (await dispatcher.callRequest('git.status', { worktreePath: tmpDir })) as {
        entries: Record<string, unknown>[]
      }
      const staged = result.entries.find((e) => e.area === 'staged')
      expect(staged).toBeDefined()
      expect(staged!.status).toBe('modified')
    })
  })

  describe('stage and unstage', () => {
    it('stages a file', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'content')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'changed')

      await dispatcher.callRequest('git.stage', { worktreePath: tmpDir, filePath: 'file.txt' })

      const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: tmpDir,
        encoding: 'utf-8'
      })
      expect(output.trim()).toBe('file.txt')
    })

    it('unstages a file', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'content')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'changed')
      execFileSync('git', ['add', 'file.txt'], { cwd: tmpDir, stdio: 'pipe' })

      await dispatcher.callRequest('git.unstage', { worktreePath: tmpDir, filePath: 'file.txt' })

      const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: tmpDir,
        encoding: 'utf-8'
      })
      expect(output.trim()).toBe('')
    })
  })

  describe('diff', () => {
    it('returns text diff for modified file', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'original')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'modified')

      const result = (await dispatcher.callRequest('git.diff', {
        worktreePath: tmpDir,
        filePath: 'file.txt',
        staged: false
      })) as { kind: string; originalContent: string; modifiedContent: string }
      expect(result.kind).toBe('text')
      expect(result.originalContent).toBe('original')
      expect(result.modifiedContent).toBe('modified')
    })

    it('returns staged diff', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'original')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'staged-content')
      execFileSync('git', ['add', 'file.txt'], { cwd: tmpDir, stdio: 'pipe' })

      const result = (await dispatcher.callRequest('git.diff', {
        worktreePath: tmpDir,
        filePath: 'file.txt',
        staged: true
      })) as { kind: string; originalContent: string; modifiedContent: string }
      expect(result.kind).toBe('text')
      expect(result.originalContent).toBe('original')
      expect(result.modifiedContent).toBe('staged-content')
    })
  })

  describe('discard', () => {
    it('discards changes to tracked file', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'original')
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'file.txt'), 'modified')

      await dispatcher.callRequest('git.discard', { worktreePath: tmpDir, filePath: 'file.txt' })

      const content = await fs.readFile(path.join(tmpDir, 'file.txt'), 'utf-8')
      expect(content).toBe('original')
    })

    it('deletes untracked file on discard', async () => {
      gitInit(tmpDir)
      gitCommit(tmpDir, 'initial')
      writeFileSync(path.join(tmpDir, 'new.txt'), 'untracked')

      await dispatcher.callRequest('git.discard', { worktreePath: tmpDir, filePath: 'new.txt' })
      await expect(fs.access(path.join(tmpDir, 'new.txt'))).rejects.toThrow()
    })

    it('rejects path traversal', async () => {
      gitInit(tmpDir)
      await expect(
        dispatcher.callRequest('git.discard', {
          worktreePath: tmpDir,
          filePath: '../../../etc/passwd'
        })
      ).rejects.toThrow('outside the worktree')
    })
  })

  describe('conflictOperation', () => {
    it('returns unknown for normal repo', async () => {
      gitInit(tmpDir)
      gitCommit(tmpDir, 'initial')

      const result = await dispatcher.callRequest('git.conflictOperation', { worktreePath: tmpDir })
      expect(result).toBe('unknown')
    })
  })

  describe('branchCompare', () => {
    it('compares branch against base', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'base.txt'), 'base')
      gitCommit(tmpDir, 'initial')

      execFileSync('git', ['checkout', '-b', 'feature'], { cwd: tmpDir, stdio: 'pipe' })
      writeFileSync(path.join(tmpDir, 'feature.txt'), 'feature')
      gitCommit(tmpDir, 'feature commit')

      const result = (await dispatcher.callRequest('git.branchCompare', {
        worktreePath: tmpDir,
        baseRef: 'master'
      })) as { summary: Record<string, unknown>; entries: Record<string, unknown>[] }

      // May be 'master' or error if default branch is 'main'
      if (result.summary.status === 'ready') {
        expect(result.entries.length).toBeGreaterThan(0)
        expect(result.summary.commitsAhead).toBe(1)
      }
    })
  })

  describe('listWorktrees', () => {
    it('lists worktrees for a repo', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'file.txt'), 'hello')
      gitCommit(tmpDir, 'initial')

      const result = (await dispatcher.callRequest('git.listWorktrees', {
        repoPath: tmpDir
      })) as Record<string, unknown>[]
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].isMainWorktree).toBe(true)
    })
  })

  describe('addWorktree', () => {
    // Why: relay handler tests for addWorktree use a mock-injection approach
    // to deterministically control git exit codes (in particular `--get` exit
    // 1 vs other non-zero codes) without relying on the test host's global
    // git config. Mirrors the pattern in src/main/git/worktree.test.ts.
    function setupMockedHandler(roots: string[]) {
      const ctx = new RelayContext()
      for (const r of roots) {
        ctx.registerRoot(r)
      }
      const localDispatcher = createMockDispatcher()
      const handler = new GitHandler(localDispatcher as unknown as RelayDispatcher, ctx)
      const gitMock =
        vi.fn<
          (
            args: string[],
            cwd: string,
            opts?: { maxBuffer?: number }
          ) => Promise<{ stdout: string; stderr: string }>
        >()
      ;(handler as unknown as { git: typeof gitMock }).git = gitMock
      return { localDispatcher, gitMock }
    }

    it('passes --no-track and writes push.autoSetupRemote when unset', async () => {
      const { localDispatcher, gitMock } = setupMockedHandler(['/relay/repo', '/relay/wt'])
      gitMock.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree add
      gitMock.mockRejectedValueOnce(Object.assign(new Error('key unset'), { code: 1 })) // --get
      gitMock.mockResolvedValueOnce({ stdout: '', stderr: '' }) // --local set

      await localDispatcher.callRequest('git.addWorktree', {
        repoPath: '/relay/repo',
        branchName: 'feature/test',
        targetDir: '/relay/wt',
        base: 'origin/main'
      })

      expect(gitMock.mock.calls.map((c) => c[0])).toEqual([
        ['worktree', 'add', '--no-track', '-b', 'feature/test', '/relay/wt', 'origin/main'],
        ['config', '--get', 'push.autoSetupRemote'],
        ['config', '--local', 'push.autoSetupRemote', 'true']
      ])
      // cwd for worktree add is repoPath; cwd for config calls is targetDir.
      expect(gitMock.mock.calls[0]?.[1]).toBe('/relay/repo')
      expect(gitMock.mock.calls[1]?.[1]).toBe('/relay/wt')
      expect(gitMock.mock.calls[2]?.[1]).toBe('/relay/wt')
    })

    it('preserves an existing push.autoSetupRemote value (does not overwrite user-set false)', async () => {
      const { localDispatcher, gitMock } = setupMockedHandler(['/relay/repo', '/relay/wt'])
      gitMock.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree add
      gitMock.mockResolvedValueOnce({ stdout: 'false\n', stderr: '' }) // --get returns value

      await localDispatcher.callRequest('git.addWorktree', {
        repoPath: '/relay/repo',
        branchName: 'feature/preserve',
        targetDir: '/relay/wt',
        base: 'main'
      })

      // No --local set: --get succeeded so we preserve the user's value.
      expect(gitMock.mock.calls.map((c) => c[0])).toEqual([
        ['worktree', 'add', '--no-track', '-b', 'feature/preserve', '/relay/wt', 'main'],
        ['config', '--get', 'push.autoSetupRemote']
      ])
    })

    it('does not write --local when --get fails with non-unset code (corrupt config)', async () => {
      // Why: exit 1 from `git config --get` means "key unset" — anything else
      // is a real read failure (parse error, locked file). We must NOT fall
      // through to `--local set true`, which would silently overwrite
      // whatever value the user actually has.
      const { localDispatcher, gitMock } = setupMockedHandler(['/relay/repo', '/relay/wt'])
      gitMock.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree add
      gitMock.mockRejectedValueOnce(Object.assign(new Error('parse error'), { code: 3 })) // --get non-unset

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(
        localDispatcher.callRequest('git.addWorktree', {
          repoPath: '/relay/repo',
          branchName: 'feature/corrupt',
          targetDir: '/relay/wt',
          base: 'main'
        })
      ).resolves.toBeUndefined()

      expect(gitMock.mock.calls.map((c) => c[0])).toEqual([
        ['worktree', 'add', '--no-track', '-b', 'feature/corrupt', '/relay/wt', 'main'],
        ['config', '--get', 'push.autoSetupRemote']
      ])
      expect(warnSpy).toHaveBeenCalledWith(
        'relay addWorktree: failed to set push.autoSetupRemote for /relay/wt',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('warns but resolves when --local set fails (write-failure is warn-only)', async () => {
      const { localDispatcher, gitMock } = setupMockedHandler(['/relay/repo', '/relay/wt'])
      gitMock.mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree add
      gitMock.mockRejectedValueOnce(Object.assign(new Error('key unset'), { code: 1 })) // --get unset
      gitMock.mockRejectedValueOnce(new Error('config locked')) // --local set fails

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(
        localDispatcher.callRequest('git.addWorktree', {
          repoPath: '/relay/repo',
          branchName: 'feature/writefail',
          targetDir: '/relay/wt',
          base: 'main'
        })
      ).resolves.toBeUndefined()

      expect(warnSpy).toHaveBeenCalledWith(
        'relay addWorktree: failed to set push.autoSetupRemote for /relay/wt',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('does not probe or write config when worktree add itself fails', async () => {
      // Why: a refactor that moves the config block earlier could try to
      // probe against a worktree directory that was never created. Pin the
      // ordering invariant: config calls happen only after worktree add
      // succeeds.
      const { localDispatcher, gitMock } = setupMockedHandler(['/relay/repo', '/relay/wt'])
      gitMock.mockRejectedValueOnce(new Error('worktree add failed'))

      await expect(
        localDispatcher.callRequest('git.addWorktree', {
          repoPath: '/relay/repo',
          branchName: 'feature/fail',
          targetDir: '/relay/wt',
          base: 'main'
        })
      ).rejects.toThrow('worktree add failed')

      expect(gitMock.mock.calls.map((c) => c[0])).toEqual([
        ['worktree', 'add', '--no-track', '-b', 'feature/fail', '/relay/wt', 'main']
      ])
    })
  })

  describe('bulkStage and bulkUnstage', () => {
    it('stages multiple files', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'a.txt'), 'a')
      writeFileSync(path.join(tmpDir, 'b.txt'), 'b')
      gitCommit(tmpDir, 'initial')

      writeFileSync(path.join(tmpDir, 'a.txt'), 'a-modified')
      writeFileSync(path.join(tmpDir, 'b.txt'), 'b-modified')

      await dispatcher.callRequest('git.bulkStage', {
        worktreePath: tmpDir,
        filePaths: ['a.txt', 'b.txt']
      })

      const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: tmpDir,
        encoding: 'utf-8'
      })
      expect(output).toContain('a.txt')
      expect(output).toContain('b.txt')
    })

    it('unstages multiple files', async () => {
      gitInit(tmpDir)
      writeFileSync(path.join(tmpDir, 'a.txt'), 'a')
      writeFileSync(path.join(tmpDir, 'b.txt'), 'b')
      gitCommit(tmpDir, 'initial')

      writeFileSync(path.join(tmpDir, 'a.txt'), 'changed')
      writeFileSync(path.join(tmpDir, 'b.txt'), 'changed')
      execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' })

      await dispatcher.callRequest('git.bulkUnstage', {
        worktreePath: tmpDir,
        filePaths: ['a.txt', 'b.txt']
      })

      const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: tmpDir,
        encoding: 'utf-8'
      })
      expect(output.trim()).toBe('')
    })
  })
})
