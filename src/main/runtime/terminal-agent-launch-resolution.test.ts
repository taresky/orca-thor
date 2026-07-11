// The terminal-create host-launch resolver: it drives the shared boundary from a
// terminal workspace descriptor, marks trust through the boundary preflight,
// injects detection, and maps the admitted plan to terminal option fields — never
// argv/env/snapshot beyond the resolved plan.
import { describe, expect, it, vi } from 'vitest'
import {
  resolveTerminalAgentLaunch,
  type TerminalAgentLaunchDeps
} from './terminal-agent-launch-resolution'
import { AgentLaunchBoundary } from '../agent-launch/agent-launch-boundary'
import {
  AgentLaunchAdmissionStore,
  LaunchAdmissionCoordinator
} from '../agent-launch/agent-launch-admission-store'
import type { AgentLaunchHostDescriptor } from '../agent-launch/agent-launch-host-state'
import type { GlobalSettings } from '../../shared/types'
import type {
  ResolveAgentLaunchRequest,
  ResolvedAgentLaunch,
  AgentLaunchSnapshot
} from '../../shared/agent-launch-host-contract'
import type { ResolveAgentLaunchOutcome } from '../agent-launch/resolve-agent-launch'
import type { AuthenticatedClientKind } from '../agent-launch/agent-launch-boundary'

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

const DESCRIPTOR: AgentLaunchHostDescriptor = { kind: 'local', platform: 'linux', shell: 'posix' }

function makeDeps(
  resolve: (request: ResolveAgentLaunchRequest) => ResolveAgentLaunchOutcome,
  overrides: Partial<TerminalAgentLaunchDeps> = {}
): TerminalAgentLaunchDeps {
  return {
    boundary: new AgentLaunchBoundary({
      admissionStore: new AgentLaunchAdmissionStore(),
      coordinator: new LaunchAdmissionCoordinator()
    }),
    getSettings: () => ({}) as GlobalSettings,
    getCatalogRevision: () => 4,
    detectStockBaseAgents: vi.fn(async () => ['claude']),
    resolveTargetHomePath: vi.fn(async () => '/home/dev'),
    markWorkspaceTrusted: vi.fn(),
    resolve: (request) => resolve(request),
    ...overrides
  }
}

function makeArgs(clientKind: AuthenticatedClientKind = undefined) {
  return {
    request: { selection: { kind: 'agent' as const, agent: 'claude' as const }, prompt: 'go' },
    clientKind,
    descriptor: DESCRIPTOR,
    scope: 'wt-1',
    worktreePath: '/repo/wt',
    repoPath: '/repo',
    principal: { kind: 'local' as const }
  }
}

describe('resolveTerminalAgentLaunch', () => {
  it('maps a resolved launch to terminal fields with the settle token + receipt', async () => {
    const resolve = vi.fn(() => ({ ok: true as const, launch: makeLaunch() }))
    const trusted: ResolvedAgentLaunch[] = []
    const detectStockBaseAgents = vi.fn(async () => ['claude'])
    const deps = makeDeps(resolve, {
      detectStockBaseAgents,
      markWorkspaceTrusted: (launch) => {
        trusted.push(launch)
      }
    })
    const result = await resolveTerminalAgentLaunch(deps, makeArgs())

    expect(result.kind).toBe('resolved')
    if (result.kind !== 'resolved') {
      return
    }
    // The command is the host-resolved argv, and launchAgent is the built-in base.
    expect(result.fields.command).toContain('/opt/resolved-claude')
    expect(result.fields.launchAgent).toBe('claude')
    expect(typeof result.fields.launchToken).toBe('string')
    expect(result.admissionToken).toBe(result.fields.launchToken)
    expect(result.receipt.baseAgent).toBe('claude')
    expect(result.receipt.catalogRevision).toBe(4)
    // Detection ran against the target descriptor.
    expect(detectStockBaseAgents).toHaveBeenCalledWith(DESCRIPTOR)
    // Trust preflight marked the workspace for the resolved launch before admission.
    expect(trusted).toHaveLength(1)
    expect(trusted[0]!.baseAgent).toBe('claude')
  })

  it.each([
    [undefined, 'desktop'],
    ['runtime', 'paired-web'],
    ['mobile', 'mobile']
  ] as const)('maps clientKind %s to launch intent client %s', async (clientKind, expected) => {
    let captured: ResolveAgentLaunchRequest | null = null
    const resolve = (request: ResolveAgentLaunchRequest): ResolveAgentLaunchOutcome => {
      captured = request
      return { ok: true as const, launch: makeLaunch() }
    }
    const deps = makeDeps(resolve)
    await resolveTerminalAgentLaunch(deps, makeArgs(clientKind))
    expect(captured!.intent).toEqual({ kind: 'interactive', client: expected })
  })

  it('returns a failed outcome (no fields) for a typed resolution failure', async () => {
    const resolve = vi.fn(() => ({
      ok: false as const,
      failure: { code: 'base_agent_disabled' as const, baseAgent: 'claude' as const }
    }))
    const deps = makeDeps(resolve)
    const result = await resolveTerminalAgentLaunch(deps, makeArgs('mobile'))
    expect(result).toEqual({
      kind: 'failed',
      outcome: {
        status: 'failed',
        failure: { code: 'base_agent_disabled', baseAgent: 'claude' }
      }
    })
  })

  it('returns a rejected outcome for a request error', async () => {
    const resolve = vi.fn(() => ({
      ok: false as const,
      requestError: { code: 'untrusted_reference' as const }
    }))
    const deps = makeDeps(resolve)
    const result = await resolveTerminalAgentLaunch(deps, makeArgs())
    expect(result).toEqual({
      kind: 'failed',
      outcome: { status: 'rejected', requestError: { code: 'untrusted_reference' } }
    })
  })
})
