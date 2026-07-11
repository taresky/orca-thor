import { describe, expect, it, vi } from 'vitest'
import {
  AgentLaunchBoundary,
  mapClientKindToLaunchClient,
  type HostStateResolution
} from './agent-launch-boundary'
import {
  AgentLaunchAdmissionStore,
  LaunchAdmissionCoordinator,
  MAX_PENDING_LAUNCHES_PER_PRINCIPAL,
  type AdmissionPrincipal
} from './agent-launch-admission-store'
import type {
  ResolvedAgentLaunch,
  AgentLaunchSnapshot
} from '../../shared/agent-launch-host-contract'
import type { ResolveAgentLaunchOutcome } from './resolve-agent-launch'

const LOCAL_PRINCIPAL: AdmissionPrincipal = { kind: 'local' }

function makeSnapshot(overrides: Partial<AgentLaunchSnapshot> = {}): AgentLaunchSnapshot {
  return {
    version: 1,
    requestedAgent: 'claude',
    baseAgent: 'claude',
    displayLabel: 'Claude',
    mode: 'built-in',
    argv: ['/bin/secretexe', '--flag'],
    agentEnv: { SECRET_ENV: 'topsecret-value' },
    target: {
      platform: 'linux',
      execution: 'native',
      shell: 'posix',
      isRemote: false,
      executionHostId: 'local'
    },
    ...overrides
  }
}

function makeLaunch(
  fingerprint: string,
  overrides: Partial<ResolvedAgentLaunch> = {}
): ResolvedAgentLaunch {
  const snapshot = overrides.snapshot ?? makeSnapshot()
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
      env: 'full'
    },
    notices: [],
    telemetry: { agentKind: 'claude-code', usedCustomAgent: false },
    admissionGuard: { fingerprint, basis: 'explicit' },
    ...overrides
  }
}

function okResolution(launch: ResolvedAgentLaunch, catalogRevision = 1): HostStateResolution {
  return { outcome: { ok: true, launch }, catalogRevision }
}

function failureResolution(
  outcome: Extract<ResolveAgentLaunchOutcome, { ok: false }>,
  catalogRevision = 1
): HostStateResolution {
  return { outcome, catalogRevision }
}

function makeBoundary(): {
  boundary: AgentLaunchBoundary
  store: AgentLaunchAdmissionStore
} {
  const store = new AgentLaunchAdmissionStore()
  const boundary = new AgentLaunchBoundary({
    admissionStore: store,
    coordinator: new LaunchAdmissionCoordinator(),
    now: () => 1000
  })
  return { boundary, store }
}

describe('mapClientKindToLaunchClient', () => {
  it('maps runtime to paired-web, mobile to mobile, undefined to desktop', () => {
    expect(mapClientKindToLaunchClient('runtime')).toBe('paired-web')
    expect(mapClientKindToLaunchClient('mobile')).toBe('mobile')
    expect(mapClientKindToLaunchClient(undefined)).toBe('desktop')
  })
})

describe('AgentLaunchBoundary.executeAgentLaunch', () => {
  it('resolves for the plan once and admits the original snapshot', async () => {
    const { boundary, store } = makeBoundary()
    const original = makeLaunch('fp-1')
    // Second resolve returns a distinct launch object with the SAME fingerprint
    // (an unrelated catalog edit). The admitted snapshot must be the original.
    const reResolveLaunch = makeLaunch('fp-1', {
      snapshot: makeSnapshot({ displayLabel: 'edited' })
    })
    const resolve = vi
      .fn<() => HostStateResolution>()
      .mockReturnValueOnce(okResolution(original))
      .mockReturnValueOnce(okResolution(reResolveLaunch, 2))

    const result = await boundary.executeAgentLaunch({
      scope: 'worktree-1',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: '',
      allowEmptyPromptLaunch: true
    })

    expect(resolve).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const admitted = store.get(result.receipt.launchToken)
    expect(admitted?.snapshot).toBe(original.snapshot)
    expect(result.receipt.catalogRevision).toBe(2)
  })

  it('returns the initial failure without admitting', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi.fn(() =>
      failureResolution({ ok: false, failure: { code: 'no_agent_selected' } })
    )
    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })
    expect(result).toEqual({ ok: false, failure: { code: 'no_agent_selected' } })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(store.pendingCount()).toBe(0)
  })

  it('returns an initial request error without admitting', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi.fn(() =>
      failureResolution({ ok: false, requestError: { code: 'untrusted_reference' } })
    )
    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })
    expect(result).toEqual({ ok: false, requestError: { code: 'untrusted_reference' } })
    expect(store.pendingCount()).toBe(0)
  })

  it('maps a base disable that wins the admission race to base_agent_disabled with no reservation', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi
      .fn<() => HostStateResolution>()
      .mockReturnValueOnce(okResolution(makeLaunch('fp-1')))
      // Mutation committed between resolve and admit: base is now disabled.
      .mockReturnValueOnce(
        failureResolution({
          ok: false,
          failure: { code: 'base_agent_disabled', baseAgent: 'claude' }
        })
      )

    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect('failure' in result && result.failure.code).toBe('base_agent_disabled')
    expect(store.pendingCount()).toBe(0)
  })

  it('maps any other relevant change to agent_configuration_changed', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi
      .fn<() => HostStateResolution>()
      .mockReturnValueOnce(okResolution(makeLaunch('fp-1')))
      // Different fingerprint: a relevant input changed (definition/default/env).
      .mockReturnValueOnce(okResolution(makeLaunch('fp-2')))

    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect('failure' in result && result.failure.code).toBe('agent_configuration_changed')
    expect(store.pendingCount()).toBe(0)
  })

  it('proceeds when only an unrelated agent changed (fingerprint unchanged)', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi
      .fn<() => HostStateResolution>()
      .mockReturnValueOnce(okResolution(makeLaunch('fp-1')))
      .mockReturnValueOnce(okResolution(makeLaunch('fp-1')))

    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })

    expect(result.ok).toBe(true)
    expect(store.pendingCount()).toBe(1)
  })

  it('fails trust_preflight_failed on a thrown preflight and admits nothing', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi.fn(() => okResolution(makeLaunch('fp-1')))
    const preflight = vi.fn(() => {
      throw new Error('trust denied')
    })

    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi',
      preflight
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect('failure' in result && result.failure.code).toBe('trust_preflight_failed')
    expect(preflight).toHaveBeenCalledTimes(1)
    // No re-resolve happened because we never entered the coordinator.
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(store.pendingCount()).toBe(0)
  })

  it('fails trust_preflight_failed on a thrown provider env preparation hook', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi.fn(() => okResolution(makeLaunch('fp-1')))
    const prepareEnv = vi.fn(async () => {
      throw new Error('env prep failed')
    })

    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi',
      prepareEnv
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect('failure' in result && result.failure.code).toBe('trust_preflight_failed')
    expect(store.pendingCount()).toBe(0)
  })

  it('rejects with launch_capacity_exceeded before producing a plan', async () => {
    const { boundary, store } = makeBoundary()
    for (let index = 0; index < MAX_PENDING_LAUNCHES_PER_PRINCIPAL; index += 1) {
      store.admit({
        principal: LOCAL_PRINCIPAL,
        intent: 'interactive',
        scope: `filler-${index}`,
        fingerprint: 'x',
        snapshot: makeSnapshot(),
        admittedAt: 1
      })
    }
    const resolve = vi.fn(() => okResolution(makeLaunch('fp-1')))

    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect('failure' in result && result.failure.code).toBe('launch_capacity_exceeded')
    expect('plan' in result).toBe(false)
  })

  it('produces a receipt free of argv, env, and snapshot material', async () => {
    const { boundary } = makeBoundary()
    const resolve = vi.fn(() => okResolution(makeLaunch('fp-1')))
    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'do the thing'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const serialized = JSON.stringify(result.receipt)
    expect(serialized).not.toContain('topsecret-value')
    expect(serialized).not.toContain('secretexe')
    expect(serialized).not.toContain('SECRET_ENV')
    expect(result.receipt.launchToken.length).toBeGreaterThan(0)
    // The plan carries the token; the receipt echoes it for the caller.
    expect(result.plan.launchToken).toBe(result.receipt.launchToken)
  })

  it('deduplicates receipt notices by code', async () => {
    const { boundary } = makeBoundary()
    const launch = makeLaunch('fp-1', {
      notices: [
        { code: 'env_withheld', label: 'Claude' },
        { code: 'env_withheld', label: 'Claude' },
        { code: 'snapshot_definition_changed', label: 'Claude' }
      ]
    })
    const resolve = vi.fn(() => okResolution(launch))
    const result = await boundary.executeAgentLaunch({
      scope: 's',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.receipt.notices.map((notice) => notice.code)).toEqual([
      'env_withheld',
      'snapshot_definition_changed'
    ])
  })
})

describe('AgentLaunchBoundary.settleAgentLaunch', () => {
  it('registered retains a private handoff record and frees the reservation', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi.fn(() => okResolution(makeLaunch('fp-1')))
    const result = await boundary.executeAgentLaunch({
      scope: 'worktree-9',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const token = result.receipt.launchToken
    boundary.settleAgentLaunch(token, 'registered')
    expect(store.get(token)).toBeNull()
    expect(store.pendingForPrincipal(LOCAL_PRINCIPAL)).toBe(0)
    expect(boundary.retainedFor(token)?.scope).toBe('worktree-9')
  })

  it('failed releases the reservation and retains nothing', async () => {
    const { boundary, store } = makeBoundary()
    const resolve = vi.fn(() => okResolution(makeLaunch('fp-1')))
    const result = await boundary.executeAgentLaunch({
      scope: 'worktree-9',
      principal: LOCAL_PRINCIPAL,
      resolve,
      prompt: 'hi'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const token = result.receipt.launchToken
    boundary.settleAgentLaunch(token, 'failed')
    expect(store.get(token)).toBeNull()
    expect(store.pendingForPrincipal(LOCAL_PRINCIPAL)).toBe(0)
    expect(boundary.retainedFor(token)).toBeNull()
  })
})
