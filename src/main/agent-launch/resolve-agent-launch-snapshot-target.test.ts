// Snapshot replay target-match rules (U5): a shell change replays when the
// snapshot's structured argv re-encodes losslessly in the new shell, while
// platform/execution/remote/host-id must still match exactly. Only `cmd` is a
// lossy target (it cannot deliver % ! ^ "), so a shell change into cmd fails
// closed when any captured element carries one of those.
import { describe, expect, it } from 'vitest'
import type { AgentLaunchSnapshot } from '../../shared/agent-launch-host-contract'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import { resolveAgentLaunch, type ResolveAgentLaunchOutcome } from './resolve-agent-launch'
import { catalogOf, requestOf, settingsOf } from './agent-launch-test-catalog'

const RESUME_DESKTOP = { kind: 'resume', operation: 'resume', client: 'desktop' } as const

function snapshotOf(overrides: {
  shell: AgentStartupShell
  argv: readonly string[]
  platform?: NodeJS.Platform
}): AgentLaunchSnapshot {
  return {
    version: 1,
    requestedAgent: 'claude',
    baseAgent: 'claude',
    displayLabel: 'Claude',
    mode: 'built-in',
    argv: overrides.argv as AgentLaunchSnapshot['argv'],
    agentEnv: {},
    capturedEnvPolicy: 'none',
    target: {
      platform: overrides.platform ?? 'win32',
      execution: 'native',
      shell: overrides.shell,
      isRemote: false,
      executionHostId: 'local'
    }
  }
}

function replay(
  snapshot: AgentLaunchSnapshot,
  target: { shell: AgentStartupShell; platform?: NodeJS.Platform }
): ResolveAgentLaunchOutcome {
  return resolveAgentLaunch(
    requestOf({
      selection: { kind: 'agent', agent: 'claude' },
      intent: RESUME_DESKTOP,
      reference: { kind: 'persisted', owner: 'session' },
      platform: target.platform ?? 'win32',
      shell: target.shell,
      persistedSnapshot: snapshot
    }),
    catalogOf({}),
    settingsOf()
  )
}

function failureCode(outcome: ResolveAgentLaunchOutcome): string | null {
  return !outcome.ok && 'failure' in outcome ? outcome.failure.code : null
}

describe('snapshot replay shell/target matching', () => {
  it('replays a shell change when every argv element re-encodes losslessly', () => {
    const outcome = replay(
      snapshotOf({ shell: 'powershell', argv: ['claude', '--flag', 'value'] }),
      {
        shell: 'cmd'
      }
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    // Replay keeps the immutable snapshot argv; only the delivery shell changed.
    expect(outcome.launch.argv).toEqual(['claude', '--flag', 'value'])
  })

  it('replays into a non-cmd shell even when captured argv carries cmd metacharacters', () => {
    const outcome = replay(snapshotOf({ shell: 'cmd', argv: ['claude', '%x!^"'] }), {
      shell: 'powershell'
    })
    expect(outcome.ok).toBe(true)
  })

  it('fails closed when a shell change into cmd cannot encode an argv element', () => {
    const outcome = replay(snapshotOf({ shell: 'powershell', argv: ['claude', '%USERPROFILE%'] }), {
      shell: 'cmd'
    })
    expect(outcome.ok).toBe(false)
    expect(failureCode(outcome)).toBe('invalid_launch_snapshot')
  })

  it('still rejects a genuine target mismatch beyond shell (platform)', () => {
    const outcome = replay(snapshotOf({ shell: 'posix', argv: ['claude'], platform: 'win32' }), {
      shell: 'posix',
      platform: 'linux'
    })
    expect(outcome.ok).toBe(false)
    expect(failureCode(outcome)).toBe('invalid_launch_snapshot')
  })
})
