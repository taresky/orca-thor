import { describe, expect, it } from 'vitest'
import {
  livenessCopy,
  resolveCapacityRowAction,
  sourceKindCopy,
  toCapacityRecoveryRowView
} from './agent-launch-capacity-recovery-rows'
import type { PendingAgentLaunchSummaryRow } from '../../../shared/agent-launch-pending-summary'

function row(overrides: Partial<PendingAgentLaunchSummaryRow> = {}): PendingAgentLaunchSummaryRow {
  return {
    sourceKind: 'interactive',
    baseHarness: 'claude',
    targetHostDisplayName: 'This Mac',
    admittedAt: 1_000,
    liveness: 'unknown',
    ...overrides
  }
}

describe('resolveCapacityRowAction', () => {
  it('opens the owning worktree when the row carries a worktree deep link', () => {
    const action = resolveCapacityRowAction(
      row({ deepLink: { kind: 'worktree', worktreeId: 'repo1::/tmp/wt' } })
    )
    expect(action).toEqual({ kind: 'open-worktree', worktreeId: 'repo1::/tmp/wt' })
  })

  it('is not routable for an ownerless row (no deep link admitted today)', () => {
    expect(resolveCapacityRowAction(row())).toBeNull()
  })

  it('is not routable for owner kinds whose producers have not landed yet', () => {
    expect(
      resolveCapacityRowAction(row({ deepLink: { kind: 'session', sessionId: 's1' } }))
    ).toBeNull()
    expect(resolveCapacityRowAction(row({ deepLink: { kind: 'run', runId: 'r1' } }))).toBeNull()
    expect(resolveCapacityRowAction(row({ deepLink: { kind: 'task', taskId: 't1' } }))).toBeNull()
  })
})

describe('toCapacityRecoveryRowView', () => {
  it('projects the redacted fields and the resolved action', () => {
    const view = toCapacityRecoveryRowView(
      row({
        sourceKind: 'cli',
        liveness: 'live',
        deepLink: { kind: 'worktree', worktreeId: 'wt-1' }
      })
    )
    expect(view).toEqual({
      sourceKind: 'cli',
      hostDisplayName: 'This Mac',
      admittedAt: 1_000,
      liveness: 'live',
      action: { kind: 'open-worktree', worktreeId: 'wt-1' }
    })
  })
})

describe('copy helpers', () => {
  it('maps every source kind to a distinct key', () => {
    const kinds = [
      'interactive',
      'cli',
      'automation',
      'background',
      'orchestration',
      'resume'
    ] as const
    const keys = kinds.map((kind) => sourceKindCopy(kind).key)
    expect(new Set(keys).size).toBe(kinds.length)
  })

  it('maps every liveness to a distinct key', () => {
    const values = ['live', 'absent', 'unknown'] as const
    const keys = values.map((value) => livenessCopy(value).key)
    expect(new Set(keys).size).toBe(values.length)
  })
})
