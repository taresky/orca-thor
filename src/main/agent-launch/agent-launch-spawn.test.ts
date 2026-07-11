import { describe, expect, it, vi } from 'vitest'
import {
  resolveAgentLaunchSpawn,
  type AgentLaunchSpawnDeps,
  type AgentLaunchSpawnInput,
  type AgentLaunchSpawnTarget
} from './agent-launch-spawn'
import { AgentLaunchBoundary } from './agent-launch-boundary'
import {
  AgentLaunchAdmissionStore,
  LaunchAdmissionCoordinator
} from './agent-launch-admission-store'
import type { GlobalSettings } from '../../shared/types'
import type {
  ResolvedAgentLaunch,
  AgentLaunchSnapshot
} from '../../shared/agent-launch-host-contract'
import type { ResolveAgentLaunchRequest } from '../../shared/agent-launch-host-contract'
import type { ResolveAgentLaunchOutcome } from './resolve-agent-launch'

function makeSnapshot(): AgentLaunchSnapshot {
  return {
    version: 1,
    requestedAgent: 'claude',
    baseAgent: 'claude',
    displayLabel: 'Claude',
    mode: 'built-in',
    argv: ['/opt/resolved-claude', '--tui'],
    agentEnv: {},
    target: {
      platform: 'linux',
      execution: 'native',
      shell: 'posix',
      isRemote: false,
      executionHostId: 'local'
    }
  }
}

function makeLaunch(): ResolvedAgentLaunch {
  const snapshot = makeSnapshot()
  return {
    requestedAgent: 'claude',
    baseAgent: 'claude',
    displayLabel: 'Claude',
    argv: snapshot.argv,
    agentEnv: snapshot.agentEnv,
    variables: { values: { repoPath: null, worktreePath: null }, referenced: [] },
    snapshot,
    policy: {
      intent: 'interactive',
      mode: 'built-in',
      client: 'desktop',
      isRemote: false,
      platform: 'linux',
      promptInjectionMode: 'stdin-after-start',
      expectedProcess: 'claude',
      env: 'none'
    },
    notices: [],
    telemetry: { agentKind: 'claude-code', usedCustomAgent: false },
    admissionGuard: { fingerprint: 'fp-1', stableInputDigest: 'sfp-1', basis: 'explicit' }
  }
}

const TARGET: AgentLaunchSpawnTarget = {
  platform: 'linux',
  shell: 'posix',
  isRemote: false,
  executionHostId: 'local',
  targetHomePath: '/home/dev'
}

function makeDeps(
  resolve: (request: ResolveAgentLaunchRequest) => ResolveAgentLaunchOutcome
): AgentLaunchSpawnDeps {
  return {
    getSettings: () => ({}) as GlobalSettings,
    getCatalogRevision: () => 7,
    boundary: new AgentLaunchBoundary({
      admissionStore: new AgentLaunchAdmissionStore(),
      coordinator: new LaunchAdmissionCoordinator()
    }),
    resolve: (request) => resolve(request)
  }
}

function baseInput(overrides: Partial<AgentLaunchSpawnInput> = {}): AgentLaunchSpawnInput {
  return {
    request: { selection: { kind: 'agent', agent: 'claude' }, prompt: 'do the thing' },
    intent: { kind: 'interactive', client: 'desktop' },
    target: TARGET,
    variables: { repoPath: '/repo', worktreePath: '/repo/wt' },
    scope: 'worktree-1',
    principal: { kind: 'local' },
    ...overrides
  }
}

describe('resolveAgentLaunchSpawn', () => {
  it('resolves the command from host state, never a client-supplied command/env', async () => {
    const resolve = vi.fn((_request: ResolveAgentLaunchRequest) => ({
      ok: true as const,
      launch: makeLaunch()
    }))
    const deps = makeDeps(resolve)
    const result = await resolveAgentLaunchSpawn(deps, baseInput())

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    // The launch command comes from the resolved argv, not any client input.
    expect(result.plan.launchCommand).toContain('/opt/resolved-claude')
    expect(result.receipt.catalogRevision).toBe(7)

    const request = resolve.mock.calls[0]![0]
    expect(request.selection).toEqual({ kind: 'agent', agent: 'claude' })
    expect(request.platform).toBe('linux')
    expect(request.executionHostId).toBe('local')
    expect(request.targetHomePath).toBe('/home/dev')
    // The request is assembled only from host inputs; it has no command/env keys.
    expect('command' in request).toBe(false)
    expect('env' in request).toBe(false)
  })

  it('derives persisted default reference for a default selection', async () => {
    const resolve = vi.fn((_request: ResolveAgentLaunchRequest) => ({
      ok: true as const,
      launch: makeLaunch()
    }))
    const deps = makeDeps(resolve)
    await resolveAgentLaunchSpawn(
      deps,
      baseInput({ request: { selection: { kind: 'default' }, prompt: 'x' } })
    )
    expect(resolve.mock.calls[0]![0].reference).toEqual({ kind: 'persisted', owner: 'default' })
  })

  it('derives live-selection reference for a bare agent selection', async () => {
    const resolve = vi.fn((_request: ResolveAgentLaunchRequest) => ({
      ok: true as const,
      launch: makeLaunch()
    }))
    const deps = makeDeps(resolve)
    await resolveAgentLaunchSpawn(deps, baseInput())
    expect(resolve.mock.calls[0]![0].reference).toEqual({ kind: 'live-selection' })
  })

  it('derives a persisted owner reference from a validated source record', async () => {
    const resolve = vi.fn((_request: ResolveAgentLaunchRequest) => ({
      ok: true as const,
      launch: makeLaunch()
    }))
    const deps = makeDeps(resolve)
    await resolveAgentLaunchSpawn(
      deps,
      baseInput({
        request: {
          selection: { kind: 'agent', agent: 'claude' },
          prompt: 'x',
          sourceRecord: { owner: 'session', id: 's-1' }
        }
      })
    )
    expect(resolve.mock.calls[0]![0].reference).toEqual({ kind: 'persisted', owner: 'session' })
  })

  it('propagates a typed resolution failure without a plan', async () => {
    const resolve = vi.fn((_request: ResolveAgentLaunchRequest) => ({
      ok: false as const,
      failure: { code: 'base_agent_unavailable' as const, baseAgent: 'claude' as const }
    }))
    const deps = makeDeps(resolve)
    const result = await resolveAgentLaunchSpawn(deps, baseInput())
    expect(result).toEqual({
      ok: false,
      failure: { code: 'base_agent_unavailable', baseAgent: 'claude' }
    })
  })
})
