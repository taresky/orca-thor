import { describe, expect, it } from 'vitest'
import { CreateTerminalTab } from './session-tabs-schemas'
import { AgentLaunchSpawnRequestSchema } from './agent-launch-spawn-schema'

const CUSTOM_ID = 'custom-agent:claude:11111111-2222-4333-8444-555555555555'

describe('legacy launch fields reject custom agent ids', () => {
  it('rejects a custom id on the legacy launchAgent field', () => {
    const parsed = CreateTerminalTab.safeParse({
      worktree: 'w1',
      launchAgent: CUSTOM_ID
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a custom id on the legacy agent preset field', () => {
    const parsed = CreateTerminalTab.safeParse({ worktree: 'w1', agent: CUSTOM_ID })
    expect(parsed.success).toBe(false)
  })

  it('accepts a built-in id on the legacy launchAgent field', () => {
    const parsed = CreateTerminalTab.safeParse({ worktree: 'w1', launchAgent: 'claude' })
    expect(parsed.success).toBe(true)
  })
})

describe('agentLaunch admits custom ids on the sanctioned path', () => {
  it('accepts a custom id in selection.agent', () => {
    const parsed = AgentLaunchSpawnRequestSchema.safeParse({
      selection: { kind: 'agent', agent: CUSTOM_ID },
      prompt: 'do the thing'
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a default selection with no prompt', () => {
    const parsed = AgentLaunchSpawnRequestSchema.safeParse({
      selection: { kind: 'default' },
      allowEmptyPromptLaunch: true
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an unknown agent id', () => {
    const parsed = AgentLaunchSpawnRequestSchema.safeParse({
      selection: { kind: 'agent', agent: 'not-a-real-agent' }
    })
    expect(parsed.success).toBe(false)
  })

  it('parses through the CreateTerminalTab agentLaunch field', () => {
    const parsed = CreateTerminalTab.safeParse({
      worktree: 'w1',
      agentLaunch: { selection: { kind: 'agent', agent: CUSTOM_ID }, prompt: 'go' }
    })
    expect(parsed.success).toBe(true)
  })
})
