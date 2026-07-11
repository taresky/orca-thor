// Post-ready prompt delivery for host-spawned created-worktree agent terminals.
// A created worktree terminal is host-spawned with no renderer writer armed, so
// the host must deliver stdin-after-start (followupPrompt) and no-native-
// affordance draft (draftPrompt) prompts itself; command-deliverable modes carry
// no post-ready text. This exercises only the delivery routing — the readiness
// writers' internal polling/paste is unit-tested separately.
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { AgentStartupPlan } from '../../shared/tui-agent-startup'
import type { AgentLaunchReceipt } from '../../shared/agent-launch-contract'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

type DeliveryInternals = {
  deliverWorktreeAgentLaunchPrompt: (
    handle: string,
    plan: AgentStartupPlan,
    receipt: AgentLaunchReceipt
  ) => void
  sendStartupFollowupWhenReady: (handle: string, followup: unknown) => void
  pasteStartupDraftWhenReady: (handle: string, draft: unknown) => void
}

// A custom requested agent whose base is a built-in — proves the draft ready
// signal keys off the base agent (custom ids are not in TUI_AGENT_CONFIG).
const RECEIPT: AgentLaunchReceipt = {
  requestedAgent: 'custom-agent:codex:01234567-89ab-4cde-8f01-23456789abcd',
  baseAgent: 'codex',
  notices: [],
  launchToken: 'tok-1',
  catalogRevision: 1
}

function basePlan(overrides: Partial<AgentStartupPlan>): AgentStartupPlan {
  return {
    agent: RECEIPT.requestedAgent,
    launchCommand: 'codex',
    expectedProcess: 'codex',
    followupPrompt: null,
    launchConfig: { agentArgs: '', agentEnv: {} },
    ...overrides
  }
}

function armDeliverySpies(runtime: OrcaRuntimeService): {
  internals: DeliveryInternals
  followup: ReturnType<typeof vi.fn>
  draft: ReturnType<typeof vi.fn>
} {
  const internals = runtime as unknown as DeliveryInternals
  const followup = vi.fn()
  const draft = vi.fn()
  internals.sendStartupFollowupWhenReady = followup
  internals.pasteStartupDraftWhenReady = draft
  return { internals, followup, draft }
}

describe('deliverWorktreeAgentLaunchPrompt', () => {
  it('submits a stdin-after-start followup prompt with the resolved expected process', () => {
    const runtime = new OrcaRuntimeService()
    const { internals, followup, draft } = armDeliverySpies(runtime)

    internals.deliverWorktreeAgentLaunchPrompt(
      'term-1',
      basePlan({ followupPrompt: 'do the thing' }),
      RECEIPT
    )

    expect(followup).toHaveBeenCalledWith('term-1', {
      expectedProcess: 'codex',
      prompt: 'do the thing'
    })
    expect(draft).not.toHaveBeenCalled()
  })

  it('pastes a no-affordance draft unsubmitted, keyed off the base agent', () => {
    const runtime = new OrcaRuntimeService()
    const { internals, followup, draft } = armDeliverySpies(runtime)

    internals.deliverWorktreeAgentLaunchPrompt(
      'term-2',
      basePlan({ draftPrompt: 'draft body' }),
      RECEIPT
    )

    // Keyed off the base agent (codex), NOT the custom requestedAgent id.
    expect(draft).toHaveBeenCalledWith('term-2', { agent: 'codex', content: 'draft body' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('delivers nothing for a command-deliverable plan (argv/flag/env prompt)', () => {
    const runtime = new OrcaRuntimeService()
    const { internals, followup, draft } = armDeliverySpies(runtime)

    internals.deliverWorktreeAgentLaunchPrompt(
      'term-3',
      basePlan({ launchCommand: 'codex --prompt "inline"' }),
      RECEIPT
    )

    expect(followup).not.toHaveBeenCalled()
    expect(draft).not.toHaveBeenCalled()
  })
})
