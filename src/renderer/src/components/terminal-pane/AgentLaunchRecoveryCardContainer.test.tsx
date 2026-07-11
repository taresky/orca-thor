// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchRecoveryCardContainer } from './AgentLaunchRecoveryCardContainer'
import type { AgentLaunchFailureCode } from '../../../../shared/agent-launch-contract'
import type { PersistedAgentLaunchFailure } from '../../../../shared/agent-launch-contract'

const WORKTREE_ID = 'repo1::/tmp/wt'

type WorktreeShape = {
  agentLaunchFailure?: PersistedAgentLaunchFailure
  pendingAgentLaunch?: { operationId: string; requestedAgent: never; priorFailureId?: string }
}

const storeBox = vi.hoisted(() => ({ state: null as unknown }))
const worktreeBox = vi.hoisted(() => ({ worktree: null as WorktreeShape | null }))

const mocks = vi.hoisted(() => ({
  retryWorktreeAgentLaunch: vi.fn(),
  forgetWorktreeAgentLaunch: vi.fn(),
  openSettingsTarget: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(storeBox.state), {
    getState: () => storeBox.state
  })
}))

vi.mock('@/store/selectors', () => ({
  getWorktreeMapFromState: () =>
    new Map(worktreeBox.worktree ? [[WORKTREE_ID, worktreeBox.worktree]] : [])
}))

function failure(code: AgentLaunchFailureCode): PersistedAgentLaunchFailure {
  return { code, version: 1, failureId: 'failure-7', intent: 'interactive', occurredAt: 0 }
}

const mountedRoots: Root[] = []

async function render(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<AgentLaunchRecoveryCardContainer worktreeId={WORKTREE_ID} />)
  })
}

function buttonByLabel(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '') === label
  )
  if (!match) {
    throw new Error(`No button labelled "${label}"`)
  }
  return match
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  mocks.retryWorktreeAgentLaunch.mockResolvedValue({ status: 'launched', receipt: {} })
  mocks.forgetWorktreeAgentLaunch.mockResolvedValue({ status: 'forgotten' })
  worktreeBox.worktree = null
  storeBox.state = {
    retryWorktreeAgentLaunch: mocks.retryWorktreeAgentLaunch,
    forgetWorktreeAgentLaunch: mocks.forgetWorktreeAgentLaunch,
    openSettingsTarget: mocks.openSettingsTarget
  }
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

describe('AgentLaunchRecoveryCardContainer', () => {
  it('renders nothing when the workspace has no durable failure', async () => {
    await render()
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
  })

  it('retries the pinned identity against the current failure id', async () => {
    worktreeBox.worktree = { agentLaunchFailure: failure('spawn_failed') }
    await render()
    await act(async () => {
      buttonByLabel('Retry').click()
    })
    expect(mocks.retryWorktreeAgentLaunch).toHaveBeenCalledExactlyOnceWith({
      worktreeId: WORKTREE_ID,
      expectedFailureId: 'failure-7',
      action: { kind: 'retry-same' }
    })
  })

  it('forgets an unknown launch using the pending operation id as the guard', async () => {
    worktreeBox.worktree = {
      agentLaunchFailure: failure('launch_state_unknown'),
      pendingAgentLaunch: { operationId: 'op-3', requestedAgent: undefined as never }
    }
    await render()
    await act(async () => {
      buttonByLabel('Forget launch…').click()
    })
    expect(mocks.forgetWorktreeAgentLaunch).toHaveBeenCalledExactlyOnceWith({
      worktreeId: WORKTREE_ID,
      expectedOperationId: 'op-3'
    })
  })

  it('does not forget when no pending operation id survives reconciliation', async () => {
    worktreeBox.worktree = { agentLaunchFailure: failure('launch_state_unknown') }
    await render()
    await act(async () => {
      buttonByLabel('Forget launch…').click()
    })
    expect(mocks.forgetWorktreeAgentLaunch).not.toHaveBeenCalled()
  })

  it('routes selection recovery to the desktop-host agents settings pane', async () => {
    worktreeBox.worktree = { agentLaunchFailure: failure('unknown_agent') }
    await render()
    await act(async () => {
      buttonByLabel('Choose agent').click()
    })
    expect(mocks.openSettingsTarget).toHaveBeenCalledExactlyOnceWith({
      pane: 'agents',
      repoId: null
    })
    expect(mocks.retryWorktreeAgentLaunch).not.toHaveBeenCalled()
  })
})
