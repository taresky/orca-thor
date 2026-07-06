import { describe, expect, it } from 'vitest'
import {
  getWorktreeIdsWithLiveAgent,
  hasActiveWorkspaceActivity,
  isInactiveWorkspace
} from './worktree-activity-state'
import type { TerminalTab } from '../../../shared/types'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'

function makeTab(id: string): Pick<TerminalTab, 'id'> {
  return { id }
}

function makeAgentEntry(
  overrides: Partial<AgentStatusEntry> & { paneKey: string }
): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 0,
    stateStartedAt: 0,
    stateHistory: [],
    ...overrides
  }
}

describe('worktree activity state', () => {
  it('treats a slept wake-hint workspace as inactive', () => {
    expect(isInactiveWorkspace('wt-1', { 'wt-1': [makeTab('tab-1')] }, { 'tab-1': [] }, {})).toBe(
      true
    )
  })

  it('treats a never-opened workspace as inactive', () => {
    expect(isInactiveWorkspace('wt-1', {}, {}, {})).toBe(true)
  })

  it('treats live terminal workspaces as active', () => {
    const tabsByWorktree = { 'wt-1': [makeTab('tab-1')] }
    const ptyIdsByTabId = { 'tab-1': ['pty-1'] }

    expect(isInactiveWorkspace('wt-1', tabsByWorktree, ptyIdsByTabId, {})).toBe(false)
    expect(hasActiveWorkspaceActivity('wt-1', tabsByWorktree, ptyIdsByTabId, {})).toBe(true)
  })

  it('treats browser workspaces as active', () => {
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('tab-1')] },
        { 'tab-1': [] },
        { 'wt-1': [{ id: 'browser-1' }] }
      )
    ).toBe(false)
  })

  it('treats pending paired web host terminal mirrors as inactive without a live pty', () => {
    expect(
      hasActiveWorkspaceActivity('wt-1', { 'wt-1': [makeTab('web-terminal-host-tab-1')] }, {}, {})
    ).toBe(false)
  })

  it('treats ready paired web host terminal mirrors as active with a live pty', () => {
    expect(
      hasActiveWorkspaceActivity(
        'wt-1',
        { 'wt-1': [makeTab('web-terminal-host-tab-1')] },
        { 'web-terminal-host-tab-1': ['pty-1'] },
        {}
      )
    ).toBe(true)
  })

  it('keeps browser-only workspaces active when mirrored terminals are pending', () => {
    expect(
      hasActiveWorkspaceActivity(
        'wt-1',
        { 'wt-1': [makeTab('web-terminal-host-tab-1')] },
        {},
        { 'wt-1': [{ id: 'browser-1' }] }
      )
    ).toBe(true)
  })

  it('keeps a workspace with a running agent active even without a live pty (#7197)', () => {
    const worktreeIdsWithLiveAgent = new Set(['wt-1'])
    expect(
      hasActiveWorkspaceActivity(
        'wt-1',
        { 'wt-1': [makeTab('tab-1')] },
        { 'tab-1': [] },
        {},
        worktreeIdsWithLiveAgent
      )
    ).toBe(true)
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('tab-1')] },
        { 'tab-1': [] },
        {},
        worktreeIdsWithLiveAgent
      )
    ).toBe(false)
  })

  it('still hides a slept workspace with no live agent entry', () => {
    expect(
      isInactiveWorkspace('wt-1', { 'wt-1': [makeTab('tab-1')] }, { 'tab-1': [] }, {}, new Set())
    ).toBe(true)
  })
})

describe('getWorktreeIdsWithLiveAgent', () => {
  it('returns an empty set when there are no agent entries', () => {
    expect(getWorktreeIdsWithLiveAgent({}, {})).toEqual(new Set())
    expect(getWorktreeIdsWithLiveAgent(null, null)).toEqual(new Set())
  })

  it('attributes an entry by its main-stamped worktreeId', () => {
    const entries = {
      'tab-1:leaf-1': makeAgentEntry({ paneKey: 'tab-1:leaf-1', worktreeId: 'wt-1' })
    }
    expect(getWorktreeIdsWithLiveAgent(entries, {})).toEqual(new Set(['wt-1']))
  })

  it('falls back to the paneKey tabId when worktreeId is absent', () => {
    const entries = {
      'tab-1:00000000-0000-4000-8000-000000000000': makeAgentEntry({
        paneKey: 'tab-1:00000000-0000-4000-8000-000000000000'
      })
    }
    expect(getWorktreeIdsWithLiveAgent(entries, { 'wt-1': [makeTab('tab-1')] })).toEqual(
      new Set(['wt-1'])
    )
  })

  it('ignores entries that cannot be attributed to any worktree', () => {
    const entries = {
      'orphan:00000000-0000-4000-8000-000000000000': makeAgentEntry({
        paneKey: 'orphan:00000000-0000-4000-8000-000000000000'
      })
    }
    expect(getWorktreeIdsWithLiveAgent(entries, {})).toEqual(new Set())
  })
})
