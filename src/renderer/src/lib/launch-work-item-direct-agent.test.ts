import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
  tuiAgentToAgentKind: (agent: string) => agent
}))

import { buildDirectWorkItemAgentLaunchStartup } from './launch-work-item-direct-agent'

describe('buildDirectWorkItemAgentLaunchStartup', () => {
  it('builds an identity-only draft launch that never carries a client command or args', () => {
    const startup = buildDirectWorkItemAgentLaunchStartup({
      agent: 'codex',
      draftContent: 'Review this linked issue',
      promptDelivery: 'draft',
      launchSource: 'task_page'
    })

    expect(startup).toEqual({
      command: '',
      launchAgent: 'codex',
      agentLaunch: {
        selection: { kind: 'agent', agent: 'codex' },
        prompt: 'Review this linked issue',
        promptDelivery: 'draft'
      },
      telemetry: {
        agent_kind: 'codex',
        launch_source: 'task_page',
        request_kind: 'new'
      }
    })
  })

  it('maps submit-after-ready to a submit delivery and lets the host own fold-vs-paste', () => {
    const startup = buildDirectWorkItemAgentLaunchStartup({
      agent: 'claude',
      draftContent: 'Fix the failing checks.',
      promptDelivery: 'submit-after-ready',
      launchSource: 'task_page'
    })

    expect(startup.agentLaunch).toEqual({
      selection: { kind: 'agent', agent: 'claude' },
      prompt: 'Fix the failing checks.',
      promptDelivery: 'submit'
    })
    expect(startup.command).toBe('')
    expect(startup).not.toHaveProperty('launchConfig')
  })

  it('launches bare with allowEmptyPromptLaunch when there is no draft content', () => {
    const startup = buildDirectWorkItemAgentLaunchStartup({
      agent: 'codex',
      draftContent: '   ',
      promptDelivery: 'draft',
      launchSource: 'task_page'
    })

    expect(startup.agentLaunch).toEqual({
      selection: { kind: 'agent', agent: 'codex' },
      allowEmptyPromptLaunch: true
    })
    expect(startup.agentLaunch).not.toHaveProperty('prompt')
  })
})
