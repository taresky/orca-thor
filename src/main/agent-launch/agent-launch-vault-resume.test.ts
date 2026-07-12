import { describe, expect, it } from 'vitest'
import {
  buildVaultResumeStartup,
  findVaultResumeSession,
  resolveVaultResumeCopyCommand,
  type VaultResumeSession
} from './agent-launch-vault-resume'
import { RESUMABLE_TUI_AGENTS } from '../../shared/agent-session-resume'
import { AI_VAULT_AGENTS, type AiVaultAgent } from '../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AgentLaunchVaultResumeEntry } from '../../shared/agent-launch-spawn-request'

// Agents that are both AI Vault sessions AND resumable providers take the
// structured startup-plan branch; the rest (e.g. OMP) fall through to the
// path-based resume command. G5 requires every resumable provider to be proven.
const RESUMABLE_VAULT_AGENTS = AI_VAULT_AGENTS.filter((agent) =>
  (RESUMABLE_TUI_AGENTS as readonly string[]).includes(agent)
)

function vaultSession(overrides: Partial<VaultResumeSession> = {}): VaultResumeSession {
  return {
    agent: 'codex',
    sessionId: 'sess-abc-123',
    cwd: '/repo/app',
    codexHome: null,
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    ...overrides
  }
}

function entryFor(session: VaultResumeSession): AgentLaunchVaultResumeEntry {
  return {
    executionHostId: session.executionHostId,
    agent: session.agent,
    sessionId: session.sessionId
  }
}

describe('findVaultResumeSession', () => {
  it('matches on executionHostId, agent, and sessionId', () => {
    const target = vaultSession({ sessionId: 'match-me' })
    const sessions = [vaultSession({ sessionId: 'other' }), target]
    expect(findVaultResumeSession(entryFor(target), sessions)).toBe(target)
  })

  it('returns null when any identity field differs', () => {
    const target = vaultSession({ sessionId: 'match-me', agent: 'codex' })
    const sessions = [target]
    expect(findVaultResumeSession({ ...entryFor(target), sessionId: 'nope' }, sessions)).toBeNull()
    expect(findVaultResumeSession({ ...entryFor(target), agent: 'claude' }, sessions)).toBeNull()
    expect(
      findVaultResumeSession({ ...entryFor(target), executionHostId: 'ssh:box' }, sessions)
    ).toBeNull()
  })

  it('ignores the client-echoed filePath entirely (host re-derives identity)', () => {
    const target = vaultSession({ agent: 'omp', filePath: '/host/derived.jsonl' })
    // A client sending a bogus filePath still matches on the three identity
    // fields and the assembly reads the host-discovered filePath, never this one.
    const entry: AgentLaunchVaultResumeEntry = {
      ...entryFor(target),
      filePath: '/attacker/controlled.jsonl'
    }
    expect(findVaultResumeSession(entry, [target])).toBe(target)
  })
})

describe('buildVaultResumeStartup', () => {
  it('appends the provider resume argv exactly once for every resumable vault agent', () => {
    for (const agent of RESUMABLE_VAULT_AGENTS) {
      const session = vaultSession({ agent: agent as AiVaultAgent, sessionId: `id-${agent}` })
      const startup = buildVaultResumeStartup({ session, hostPlatform: 'linux' })
      expect(startup.command).toContain(`id-${agent}`)
      // The session id is the resume target and must appear exactly once.
      expect(startup.command.split(`id-${agent}`).length - 1).toBe(1)
      expect(startup.launchConfig).toBeDefined()
      // The queued command re-enters the session's cwd before launching.
      expect(startup.command).toContain('/repo/app')
    }
  })

  it('resumes OMP by its host-derived transcript path, not the client field', () => {
    const session = vaultSession({
      agent: 'omp',
      sessionId: 'omp-sess',
      filePath: '/host/transcripts/omp-sess.jsonl'
    })
    const startup = buildVaultResumeStartup({ session, hostPlatform: 'linux' })
    // OMP is non-resumable → the path-based fallback resumes by absolute path.
    expect(startup.command).toContain('/host/transcripts/omp-sess.jsonl')
    expect(startup.launchConfig).toBeUndefined()
  })

  it('replays a remote session command verbatim without re-deriving it', () => {
    const session = vaultSession({
      agent: 'codex',
      executionHostId: 'ssh:box',
      executionHostPlatform: 'linux',
      resumeCommand: 'REMOTE_READY_COMMAND --resume remote-id'
    })
    const startup = buildVaultResumeStartup({ session, hostPlatform: 'darwin' })
    expect(startup.command).toBe('REMOTE_READY_COMMAND --resume remote-id')
    expect(startup.launchConfig).toBeUndefined()
    expect(startup.env).toBeUndefined()
  })

  it('rewrites a WSL UNC Codex home to POSIX when the target is linux', () => {
    const session = vaultSession({
      agent: 'codex',
      codexHome: '\\\\wsl$\\Ubuntu\\home\\me\\.codex'
    })
    const startup = buildVaultResumeStartup({ session, hostPlatform: 'linux' })
    expect(startup.command).toContain('/home/me/.codex')
    expect(startup.command).not.toContain('wsl$')
  })

  it('honors a per-agent command override', () => {
    const session = vaultSession({ agent: 'codex', sessionId: 'ov-id' })
    const startup = buildVaultResumeStartup({
      session,
      hostPlatform: 'linux',
      settings: { agentCmdOverrides: { codex: 'my-codex' } }
    })
    expect(startup.command).toContain('my-codex')
  })
})

describe('resolveVaultResumeCopyCommand', () => {
  it('returns the assembled command for a discovered entry', () => {
    const session = vaultSession({ agent: 'codex', sessionId: 'copy-id' })
    const result = resolveVaultResumeCopyCommand({
      entry: entryFor(session),
      sessions: [session],
      hostPlatform: 'linux'
    })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.command).toBe(
        buildVaultResumeStartup({ session, hostPlatform: 'linux' }).command
      )
    }
  })

  it('fails closed with invalid_launch_snapshot when the host did not discover the entry', () => {
    const session = vaultSession({ sessionId: 'known' })
    const result = resolveVaultResumeCopyCommand({
      entry: { ...entryFor(session), sessionId: 'unknown' },
      sessions: [session],
      hostPlatform: 'linux'
    })
    expect(result).toEqual({
      status: 'failed',
      failure: { code: 'invalid_launch_snapshot' }
    })
  })
})
