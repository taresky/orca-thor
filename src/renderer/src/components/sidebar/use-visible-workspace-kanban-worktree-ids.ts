import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { Repo, Worktree } from '../../../../shared/types'
import { computeVisibleWorktreeIds } from './visible-worktrees'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'

type UseVisibleWorkspaceKanbanWorktreeIdsParams = {
  allWorktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
}

// Why module-level: a stable empty array keeps the useShallow selector from
// allocating a fresh reference each render when Hide sleeping is off.
const EMPTY_LIVE_AGENT_LIST: string[] = []

export function useVisibleWorkspaceKanbanWorktreeIds({
  allWorktrees,
  repoMap
}: UseVisibleWorkspaceKanbanWorktreeIdsParams): ReadonlySet<string> {
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const showSleepingWorkspaces = useAppStore((s) => s.showSleepingWorkspaces)
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const hideAutomationGeneratedWorkspaces = useAppStore((s) => s.hideAutomationGeneratedWorkspaces)
  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)
  const visibleWorkspaceHostIds = useAppStore((s) => s.visibleWorkspaceHostIds)
  const settings = useAppStore((s) => s.settings)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const tabsByWorktree = useAppStore((s) => (!showSleepingWorkspaces ? s.tabsByWorktree : null))
  const ptyIdsByTabId = useAppStore((s) => (!showSleepingWorkspaces ? s.ptyIdsByTabId : null))
  const browserTabsByWorktree = useAppStore((s) =>
    !showSleepingWorkspaces ? s.browserTabsByWorktree : null
  )
  // Why useShallow over a sorted id list: the board must keep running-agent
  // workspaces visible under Hide sleeping, but agent-status pings change the
  // raw map constantly — gating re-renders on set membership avoids churn. #7197
  const worktreeIdsWithLiveAgentList = useAppStore(
    useShallow((s) =>
      !showSleepingWorkspaces
        ? [...getWorktreeIdsWithLiveAgent(s.agentStatusByPaneKey, s.tabsByWorktree)].sort()
        : EMPTY_LIVE_AGENT_LIST
    )
  )
  const worktreeIdsWithLiveAgent = useMemo(
    () => new Set(worktreeIdsWithLiveAgentList),
    [worktreeIdsWithLiveAgentList]
  )

  return useMemo(() => {
    // Why: the board has its own status ordering, but visibility must match
    // the sidebar filters exactly so hidden workspaces do not reappear here.
    const sortedIds = allWorktrees.map((worktree) => worktree.id)
    return new Set(
      computeVisibleWorktreeIds(worktreesByRepo, sortedIds, {
        filterRepoIds,
        showSleepingWorkspaces,
        tabsByWorktree,
        ptyIdsByTabId,
        browserTabsByWorktree,
        worktreeIdsWithLiveAgent,
        hideDefaultBranchWorkspace,
        hideAutomationGeneratedWorkspaces,
        repoMap,
        workspaceHostScope,
        visibleWorkspaceHostIds,
        defaultHostId: getSettingsFocusedExecutionHostId(settings),
        // Why: the board has no nested lineage presentation. Ancestor injection
        // would make filtered-out parents appear as ordinary cards.
        worktreeLineageById: {}
      })
    )
  }, [
    allWorktrees,
    browserTabsByWorktree,
    filterRepoIds,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    workspaceHostScope,
    visibleWorkspaceHostIds,
    settings,
    ptyIdsByTabId,
    repoMap,
    showSleepingWorkspaces,
    tabsByWorktree,
    worktreeIdsWithLiveAgent,
    worktreesByRepo
  ])
}
