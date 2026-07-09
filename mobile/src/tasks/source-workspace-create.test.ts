import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createWorkspaceFromSource } from './source-workspace-create'
import {
  buildBranchSource,
  buildGitHubTaskSource,
  buildLinearTaskSource,
  buildNewBranchSource
} from './workspace-source-selection'

type Call = { method: string; params: unknown }

function fakeClient(script: (method: string) => unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: async (method: string, params?: unknown) => {
      calls.push({ method, params })
      const result = script(method)
      if (result instanceof Error) {
        return {
          id: '1',
          ok: false,
          error: { code: 'x', message: result.message },
          _meta: { runtimeId: 'r' }
        }
      }
      return { id: '1', ok: true, result, _meta: { runtimeId: 'r' } }
    }
  } as unknown as RpcClient
}

describe('createWorkspaceFromSource', () => {
  it('resolves the PR base then creates a workspace linked to the PR', async () => {
    const calls: Call[] = []
    const client = fakeClient((method) => {
      if (method === 'worktree.resolvePrBase') {
        return { baseBranch: 'main', pushTarget: { remoteName: 'origin', branchName: 'feat' } }
      }
      return { worktree: { id: 'wt-1' } }
    }, calls)

    const result = await createWorkspaceFromSource({
      client,
      source: buildGitHubTaskSource('repo-1', {
        type: 'pr',
        number: 42,
        title: 'Fix login',
        url: 'https://github.com/acme/app/pull/42',
        branchName: 'feat',
        isCrossRepository: false
      }) as never,
      targetRepoId: 'repo-1',
      setupDecision: 'inherit',
      agent: { choice: 'codex', startupCommand: undefined },
      workspaceName: undefined,
      note: undefined
    })

    expect(result).toEqual({ worktreeId: 'wt-1', name: 'pr-42' })
    expect(calls[0]).toEqual({
      method: 'worktree.resolvePrBase',
      params: { repo: 'id:repo-1', prNumber: 42, headRefName: 'feat', isCrossRepository: false }
    })
    const createParams = calls[1]?.params as Record<string, unknown>
    expect(calls[1]?.method).toBe('worktree.create')
    expect(createParams.linkedPR).toBe(42)
    expect(createParams.baseBranch).toBe('main')
    expect(createParams.createdWithAgent).toBe('codex')
    expect(createParams.startupDraft).toBe('https://github.com/acme/app/pull/42')
    expect(createParams.pushTarget).toEqual({ remoteName: 'origin', branchName: 'feat' })
  })

  it('creates a branch workspace with baseBranch + branchNameOverride and no resolve call', async () => {
    const calls: Call[] = []
    const client = fakeClient(() => ({ worktree: { id: 'wt-2' } }), calls)

    const result = await createWorkspaceFromSource({
      client,
      source: buildBranchSource('origin/main', 'main') as never,
      targetRepoId: 'repo-9',
      setupDecision: 'run',
      agent: { choice: 'blank', startupCommand: undefined },
      workspaceName: undefined,
      note: undefined
    })

    expect(result).toEqual({ worktreeId: 'wt-2', name: 'main' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('worktree.create')
    const params = calls[0]?.params as Record<string, unknown>
    expect(params).toMatchObject({
      repo: 'id:repo-9',
      name: 'main',
      baseBranch: 'origin/main',
      branchNameOverride: 'main',
      setupDecision: 'run'
    })
    expect(params.createdWithAgent).toBeUndefined()
  })

  it('links a Linear issue to the target repo without a resolve call', async () => {
    const calls: Call[] = []
    const client = fakeClient(() => ({ worktree: { id: 'wt-3' } }), calls)

    await createWorkspaceFromSource({
      client,
      source: buildLinearTaskSource({
        identifier: 'ENG-42',
        title: 'Onboarding',
        url: 'https://linear.app/acme/issue/ENG-42'
      }) as never,
      targetRepoId: 'repo-5',
      setupDecision: 'inherit',
      agent: { choice: 'blank', startupCommand: undefined },
      workspaceName: undefined,
      note: undefined
    })

    expect(calls).toHaveLength(1)
    const params = calls[0]?.params as Record<string, unknown>
    expect(params.repo).toBe('id:repo-5')
    expect(params.linkedLinearIssue).toBe('ENG-42')
  })

  it('bumps the branch name (not just display) when a new branch collides', async () => {
    const calls: Call[] = []
    let attempt = 0
    const client = fakeClient((method) => {
      if (method === 'worktree.create') {
        attempt += 1
        if (attempt === 1) {
          return new Error('Branch feature already exists locally')
        }
      }
      return { worktree: { id: 'wt-nb' } }
    }, calls)

    const result = await createWorkspaceFromSource({
      client,
      source: buildNewBranchSource('main', 'feature') as never,
      targetRepoId: 'repo-1',
      setupDecision: 'inherit',
      agent: { choice: 'blank', startupCommand: undefined },
      workspaceName: undefined,
      note: undefined
    })

    expect(result).toEqual({ worktreeId: 'wt-nb', name: 'feature-2' })
    const creates = calls.filter((call) => call.method === 'worktree.create')
    expect(creates).toHaveLength(2)
    const first = creates[0]?.params as Record<string, unknown>
    const second = creates[1]?.params as Record<string, unknown>
    expect(first.branchNameOverride).toBe('feature')
    expect(second.branchNameOverride).toBe('feature-2')
    expect(second.name).toBe('feature-2')
    expect(second.baseBranch).toBe('main')
  })

  it('fails fast (no retry) when reusing an existing branch that collides', async () => {
    const calls: Call[] = []
    const client = fakeClient((method) => {
      if (method === 'worktree.create') {
        return new Error('Branch "main" already exists locally.')
      }
      return { worktree: { id: 'wt-4' } }
    }, calls)

    const result = await createWorkspaceFromSource({
      client,
      source: buildBranchSource('origin/main', 'main') as never,
      targetRepoId: 'repo-1',
      setupDecision: 'inherit',
      agent: { choice: 'blank', startupCommand: undefined },
      workspaceName: undefined,
      note: undefined
    })

    // branchNameOverride is fixed for reuse, so suffixing can't help — one attempt only.
    expect(result).toEqual({ error: 'Branch "main" already exists locally.' })
    expect(calls.filter((call) => call.method === 'worktree.create')).toHaveLength(1)
  })
})
