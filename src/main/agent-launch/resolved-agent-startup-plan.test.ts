import { describe, expect, it } from 'vitest'
import { resolveAgentLaunch } from './resolve-agent-launch'
import {
  catalogOf,
  customAgent,
  customId,
  requestOf,
  settingsOf
} from './agent-launch-test-catalog'
import { buildAgentStartupPlanFromResolvedLaunch } from '../../shared/resolved-agent-startup-plan'
import type { ResolvedAgentLaunch } from '../../shared/agent-launch-host-contract'

function resolvedLaunch(
  overrides: Parameters<typeof requestOf>[0] extends infer _ ? Record<string, unknown> : never = {}
): ResolvedAgentLaunch {
  const outcome = resolveAgentLaunch(
    requestOf({
      selection: {
        kind: 'agent',
        agent: (overrides.agent as ResolvedAgentLaunch['requestedAgent']) ?? 'codex'
      },
      ...(overrides.request as object)
    }),
    (overrides.catalog as ReturnType<typeof catalogOf>) ?? catalogOf({}),
    // Explicit empty args: an absent key falls back to the shipped YOLO
    // defaults, which would clutter the exact-argv assertions below.
    settingsOf({
      agentDefaultArgs: {
        codex: '',
        grok: '',
        gemini: '',
        opencode: '',
        copilot: '',
        autohand: '',
        kiro: ''
      }
    })
  )
  if (!outcome.ok || !('launch' in outcome)) {
    throw new Error('fixture launch failed to resolve')
  }
  return outcome.launch
}

describe('buildAgentStartupPlanFromResolvedLaunch', () => {
  it('appends an argv prompt once and quotes each element for the target shell', () => {
    const launch = resolvedLaunch()
    const plan = buildAgentStartupPlanFromResolvedLaunch({ launch, prompt: 'fix the tests' })
    expect(plan?.launchCommand).toBe(`'codex' 'fix the tests'`)
    expect(plan?.followupPrompt).toBeNull()
    // The immutable snapshot argv is never extended by the prompt.
    expect(launch.snapshot.argv).toEqual(['codex'])
    expect(plan?.startupCommandDelivery).toBe('shell-ready')
  })

  it('keeps grok option termination before a flag-shaped prompt', () => {
    const launch = resolvedLaunch({ agent: 'grok' })
    const plan = buildAgentStartupPlanFromResolvedLaunch({ launch, prompt: '--version' })
    expect(plan?.launchCommand).toBe(`'grok' '--' '--version'`)
  })

  it('uses the flag modes from resolved policy, not a config re-read', () => {
    const opencode = buildAgentStartupPlanFromResolvedLaunch({
      launch: resolvedLaunch({ agent: 'opencode' }),
      prompt: 'p'
    })
    expect(opencode?.launchCommand).toBe(`'opencode' '--prompt' 'p'`)
    const gemini = buildAgentStartupPlanFromResolvedLaunch({
      launch: resolvedLaunch({ agent: 'gemini' }),
      prompt: 'p'
    })
    expect(gemini?.launchCommand).toBe(`'gemini' '--prompt-interactive' 'p'`)
    const copilot = buildAgentStartupPlanFromResolvedLaunch({
      launch: resolvedLaunch({ agent: 'copilot' }),
      prompt: 'p'
    })
    expect(copilot?.launchCommand).toBe(`'copilot' '-i' 'p'`)
  })

  it('routes stdin-after-start agents through the followup writer with a bare TUI launch', () => {
    const launch = resolvedLaunch({ agent: 'autohand' })
    const plan = buildAgentStartupPlanFromResolvedLaunch({ launch, prompt: 'do the thing' })
    expect(plan?.launchCommand).toBe(`'autohand'`)
    expect(plan?.followupPrompt).toBe('do the thing')
  })

  it('preserves fixed catalog subcommands in the quoted command', () => {
    const launch = resolvedLaunch({ agent: 'kiro' })
    const plan = buildAgentStartupPlanFromResolvedLaunch({
      launch,
      prompt: '',
      allowEmptyPromptLaunch: true
    })
    expect(plan?.launchCommand).toBe(`'kiro-cli' 'chat' '--tui'`)
  })

  it('carries custom argv and admitted env without reparsing', () => {
    const id = customId('codex')
    const launch = resolvedLaunch({
      agent: id,
      catalog: catalogOf({
        customTuiAgents: [
          customAgent({
            id,
            baseAgent: 'codex',
            label: 'Mine',
            commandOverride: '/opt/my tools/codex',
            args: '--model x',
            env: { API_KEY: 'v' }
          })
        ]
      })
    })
    const plan = buildAgentStartupPlanFromResolvedLaunch({ launch, prompt: 'go' })
    expect(plan?.launchCommand).toBe(`'/opt/my tools/codex' '--model' 'x' 'go'`)
    expect(plan?.env).toEqual({ API_KEY: 'v' })
    expect(plan?.launchConfig.agentEnv).toEqual({ API_KEY: 'v' })
  })

  it('returns null for an empty prompt unless the surface allows a bare TUI', () => {
    const launch = resolvedLaunch()
    expect(buildAgentStartupPlanFromResolvedLaunch({ launch, prompt: '  ' })).toBeNull()
    expect(
      buildAgentStartupPlanFromResolvedLaunch({
        launch,
        prompt: '',
        allowEmptyPromptLaunch: true
      })?.launchCommand
    ).toBe(`'codex'`)
  })
})
