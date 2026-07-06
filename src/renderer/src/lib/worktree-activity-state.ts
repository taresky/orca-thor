import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import type { TerminalTab } from '../../../shared/types'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'

type TerminalLikeTab = Pick<TerminalTab, 'id'>
type BrowserLikeTab = { id: string }

type TabsByWorktree = Record<string, readonly TerminalLikeTab[]>
type PtyIdsByTabId = Record<string, string[]>
type BrowserTabsByWorktree = Record<string, readonly BrowserLikeTab[]>

/**
 * Worktree ids that currently have a live agent session, derived from the
 * live `agentStatusByPaneKey` map.
 *
 * Why presence is a reliable liveness signal: entries live in this map only
 * while an agent is attached — sleep and teardown drop every entry attributed
 * to the worktree via `dropAgentStatusByWorktree` (completed rows move to the
 * separate `retainedAgentsByPaneKey`), so a lingering entry never resurrects a
 * slept/hibernated workspace. Each entry is attributed by its main-stamped
 * `worktreeId`, falling back to the paneKey's tabId — orchestration workers can
 * report status before their terminal tab is mirrored in the renderer.
 */
export function getWorktreeIdsWithLiveAgent(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined
): Set<string> {
  const entries = Object.values(agentStatusByPaneKey ?? {})
  if (entries.length === 0) {
    return new Set()
  }
  const worktreeIdByTabId = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      worktreeIdByTabId.set(tab.id, worktreeId)
    }
  }
  const result = new Set<string>()
  for (const entry of entries) {
    const worktreeId =
      entry.worktreeId ?? worktreeIdByTabId.get(parsePaneKey(entry.paneKey)?.tabId ?? '')
    if (worktreeId) {
      result.add(worktreeId)
    }
  }
  return result
}

export function hasActiveWorkspaceActivity(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId | null | undefined,
  browserTabsByWorktree: BrowserTabsByWorktree | null | undefined,
  worktreeIdsWithLiveAgent?: ReadonlySet<string> | null
): boolean {
  const tabs = tabsByWorktree?.[worktreeId] ?? []
  const hasLiveTerminal =
    ptyIdsByTabId != null && tabs.some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id))
  const hasBrowser = (browserTabsByWorktree?.[worktreeId] ?? []).length > 0
  // Why: a running agent session keeps the workspace visible under "Hide
  // sleeping" even when its live-PTY entry is momentarily absent (SSH reconnect
  // grace, an unmounted pane, a remote surface not yet `ready`). #7197
  const hasLiveAgent = worktreeIdsWithLiveAgent?.has(worktreeId) ?? false
  return hasLiveTerminal || hasBrowser || hasLiveAgent
}

export function isInactiveWorkspace(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId | null | undefined,
  browserTabsByWorktree: BrowserTabsByWorktree | null | undefined,
  worktreeIdsWithLiveAgent?: ReadonlySet<string> | null
): boolean {
  return !hasActiveWorkspaceActivity(
    worktreeId,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    worktreeIdsWithLiveAgent
  )
}
