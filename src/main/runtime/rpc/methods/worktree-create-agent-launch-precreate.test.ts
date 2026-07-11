import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { WORKTREE_METHODS } from './worktree'
import { WorktreeAgentLaunchPreCreateError } from '../../../agent-launch/agent-launch-worktree-resolution'

const repo = {
  id: 'repo-1',
  path: '/workspace/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 1,
  kind: 'git' as const,
  executionHostId: 'ssh:ssh-target-1' as const
}

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

const agentLaunch = { selection: { kind: 'default' as const }, allowEmptyPromptLaunch: true }

describe('worktree.create pre-create agent-launch rejection', () => {
  it('returns a pre-create launch failure in-band as created:false, never a thrown RPC error', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      showRepo: vi.fn().mockResolvedValue(repo),
      createManagedWorktree: vi.fn().mockRejectedValue(
        new WorktreeAgentLaunchPreCreateError({
          failure: { code: 'base_agent_disabled', baseAgent: 'claude' }
        })
      )
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('worktree.create', { repo: 'repo-1', name: 'agent-launch', agentLaunch })
    )

    // A pre-create rejection created no worktree, so it is an RPC SUCCESS with
    // `created: false` — a thrown error envelope would drop the typed recovery
    // hints the composer needs on every transport.
    expect(response).toMatchObject({
      ok: true,
      result: {
        created: false,
        agentLaunchResult: { status: 'failed', failure: { code: 'base_agent_disabled' } }
      }
    })
    const result = (response as { result: Record<string, unknown> }).result
    expect(result).not.toHaveProperty('worktree')
  })

  it('returns a pre-create request rejection in-band as created:false', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      showRepo: vi.fn().mockResolvedValue(repo),
      createManagedWorktree: vi
        .fn()
        .mockRejectedValue(
          new WorktreeAgentLaunchPreCreateError({ requestError: { code: 'untrusted_reference' } })
        )
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('worktree.create', { repo: 'repo-1', name: 'agent-launch', agentLaunch })
    )

    expect(response).toMatchObject({
      ok: true,
      result: {
        created: false,
        agentLaunchResult: { status: 'rejected', requestError: { code: 'untrusted_reference' } }
      }
    })
  })
})
