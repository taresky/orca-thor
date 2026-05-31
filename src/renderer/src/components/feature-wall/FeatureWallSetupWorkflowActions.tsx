import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Plus, Save, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { getDefaultRepoHookSettings } from '../../../../shared/constants'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { RepoHookSettings, TerminalPaneLayoutNode, Worktree } from '../../../../shared/types'
import { getRepositoryLocalCommandsSectionId } from '../settings/repository-settings-targets'
import { AddReposAnimatedVisual } from './AddReposAnimatedVisual'
import { SetupTwoAgentsVisual, SetupWorkspacesVisual } from './FeatureWallSetupStepVisuals'
import { SetupScriptAnimatedVisual } from './SetupScriptAnimatedVisual'
import {
  requestContextualTourWhenReady,
  type RequestContextualTourWhenReadyArgs
} from '../contextual-tours/request-contextual-tour-when-ready'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'

export function AddReposAction(props: { reducedMotion: boolean }): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  return (
    <div className="space-y-4">
      <AddReposAnimatedVisual reducedMotion={props.reducedMotion} />
      <Button type="button" size="sm" className="w-fit gap-2" onClick={() => openModal('add-repo')}>
        <Plus className="size-3.5" />
        Add project
      </Button>
    </div>
  )
}

export function TwoAgentsAction(props: { reducedMotion: boolean }): React.JSX.Element {
  const targetWorktree = useSetupTargetWorktree()
  const openModal = useAppStore((s) => s.openModal)
  const closeModal = useAppStore((s) => s.closeModal)
  const paneTarget = useSecondPaneTarget(targetWorktree?.id ?? null)
  const handlePrimaryAction = useCallback(() => {
    cancelPendingSetupGuideTourRequest()
    if (!targetWorktree) {
      const tourRequestId = createSetupGuideTourRequestId()
      openModal('new-workspace-composer', {
        telemetrySource: 'unknown',
        contextualTourSource: 'setup_guide_parallel_work',
        setupGuideTourRequestId: tourRequestId
      })
      requestSetupGuideTourWhenReady({
        id: 'workspace-creation',
        source: 'setup_guide_parallel_work',
        wasFeaturePreviouslyInteracted: false,
        shouldContinue: () => isSetupGuideWorkspaceComposerRequestCurrent(tourRequestId)
      })
      return
    }
    if (paneTarget) {
      closeModal()
      requestSetupGuideTourAfterFrame(() => {
        activateAndRevealWorktree(targetWorktree.id)
        useAppStore.getState().setActiveTabType('terminal')
        activateTabAndFocusPane(paneTarget.tabId, paneTarget.leafId, {
          flashFocusedPane: true
        })
      })
      return
    }
    closeModal()
    requestSetupGuideTourAfterFrame(() => {
      activateWorktreeTerminalForSetupTour(targetWorktree.id)
      requestSetupGuideTourWhenReady({
        id: 'workspace-agent-sessions',
        source: 'setup_guide_parallel_work',
        wasFeaturePreviouslyInteracted: false,
        shouldContinue: () => isWorktreeTerminalStillCurrent(targetWorktree.id)
      })
    })
  }, [closeModal, openModal, paneTarget, targetWorktree])

  const handleSecondaryAction = useCallback(() => {
    cancelPendingSetupGuideTourRequest()
    if (!targetWorktree) {
      return
    }
    closeModal()
    window.requestAnimationFrame(() => {
      activateAndRevealWorktree(targetWorktree.id)
    })
  }, [closeModal, targetWorktree])

  return (
    <div className="space-y-4">
      <SetupTwoAgentsVisual reducedMotion={props.reducedMotion} />
      <div className="space-y-2">
        <p className="max-w-[48ch] text-xs text-muted-foreground">
          {paneTarget
            ? 'You already have room for parallel work. Focus the second pane, then start another agent manually.'
            : 'Split the terminal first, then start another agent manually in the new pane.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="w-fit gap-2" onClick={handlePrimaryAction}>
            <ArrowUpRight className="size-3.5" />
            {paneTarget ? 'Focus second pane' : 'Split terminal'}
          </Button>
          {targetWorktree && !paneTarget ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={handleSecondaryAction}
            >
              Start from current workspace
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function WorkspacesAction(props: { reducedMotion: boolean }): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  return (
    <div className="space-y-4">
      <SetupWorkspacesVisual reducedMotion={props.reducedMotion} />
      <Button
        type="button"
        size="sm"
        className="w-fit gap-2"
        onClick={() => {
          cancelPendingSetupGuideTourRequest()
          const tourRequestId = createSetupGuideTourRequestId()
          openModal('new-workspace-composer', {
            ...(activeRepoId ? { initialRepoId: activeRepoId } : {}),
            telemetrySource: 'unknown',
            contextualTourSource: 'setup_guide_parallel_work',
            setupGuideTourRequestId: tourRequestId
          })
          requestSetupGuideTourWhenReady({
            id: 'workspace-creation',
            source: 'setup_guide_parallel_work',
            wasFeaturePreviouslyInteracted: false,
            shouldContinue: () => isSetupGuideWorkspaceComposerRequestCurrent(tourRequestId)
          })
        }}
      >
        <ArrowUpRight className="size-3.5" />
        Try it out
      </Button>
    </div>
  )
}

export function SetupScriptAction(props: { reducedMotion: boolean }): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const closeModal = useAppStore((s) => s.closeModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const setSettingsSearchQuery = useAppStore((s) => s.setSettingsSearchQuery)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const activeRepo = activeRepoId
    ? repos.find((entry) => entry.id === activeRepoId && isGitRepoKind(entry))
    : undefined
  const repo = activeRepo ?? repos.find((entry) => isGitRepoKind(entry)) ?? null
  const canConfigure = repo && isGitRepoKind(repo)
  const [setupScript, setSetupScript] = useState('pnpm install')

  useEffect(() => {
    if (!canConfigure) {
      setSetupScript('pnpm install')
      return
    }
    setSetupScript(repo.hookSettings?.scripts?.setup?.trim() || 'pnpm install')
  }, [canConfigure, repo])

  const openLocalCommandSettings = useCallback(() => {
    if (!repo || !isGitRepoKind(repo)) {
      return
    }
    setSettingsSearchQuery('')
    openSettingsTarget({
      pane: 'repo',
      repoId: repo.id,
      sectionId: getRepositoryLocalCommandsSectionId(repo.id)
    })
    closeModal()
    openSettingsPage()
  }, [closeModal, openSettingsPage, openSettingsTarget, repo, setSettingsSearchQuery])

  const handleSaveSetupScript = useCallback(async () => {
    if (!repo || !isGitRepoKind(repo)) {
      return
    }
    const current = repo.hookSettings
    const defaults = getDefaultRepoHookSettings()
    const nextHookSettings: RepoHookSettings = {
      ...defaults,
      ...current,
      setupRunPolicy: current?.setupRunPolicy ?? defaults.setupRunPolicy,
      // Why: setup guide edits are local repo commands and must run after save.
      commandSourcePolicy: current?.commandSourcePolicy ?? 'local-only',
      scripts: {
        ...defaults.scripts,
        ...current?.scripts,
        setup: setupScript.trim()
      }
    }
    const updated = await updateRepo(repo.id, { hookSettings: nextHookSettings })
    if (updated) {
      toast.success('Setup script saved')
    } else {
      toast.error('Failed to save setup script')
    }
  }, [repo, setupScript, updateRepo])

  return (
    <div className="space-y-4">
      <SetupScriptAnimatedVisual reducedMotion={props.reducedMotion} />
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            value={setupScript}
            disabled={!canConfigure}
            onChange={(event) => setSetupScript(event.target.value)}
            placeholder="pnpm install"
            aria-label="Setup script"
            className="font-mono text-sm"
          />
          <Button
            type="button"
            size="sm"
            className="gap-2"
            disabled={!canConfigure || setupScript.trim().length === 0}
            onClick={() => void handleSaveSetupScript()}
          >
            <Save className="size-3.5" />
            Save
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-fit gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          disabled={!canConfigure}
          onClick={openLocalCommandSettings}
        >
          <Settings className="size-3.5" />
          View in settings
        </Button>
      </div>
      {!canConfigure ? (
        <p className="max-w-[48ch] text-xs text-muted-foreground">
          Add a git project first, then configure the setup script for that repository.
        </p>
      ) : null}
    </div>
  )
}

function useSetupTargetWorktree(): Worktree | null {
  const allWorktrees = useAllWorktrees()
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  return useMemo(
    () =>
      allWorktrees.find((worktree) => worktree.id === activeWorktreeId) ?? allWorktrees[0] ?? null,
    [activeWorktreeId, allWorktrees]
  )
}

export function activateWorktreeTerminalForSetupTour(worktreeId: string): string | null {
  const activation = activateAndRevealWorktree(worktreeId)
  if (!activation) {
    return null
  }
  const state = useAppStore.getState()
  const activeRuntimeEnvironmentId = state.settings?.activeRuntimeEnvironmentId ?? null
  const webRuntimeActive = isWebRuntimeSessionActive(activeRuntimeEnvironmentId)
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const activeTerminalTabId =
    state.activeTabId && tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : null
  const tabId =
    activeTerminalTabId ??
    activation.primaryTabId ??
    tabs[0]?.id ??
    (webRuntimeActive ? null : state.createTab(worktreeId, activeGroupId).id)
  if (!tabId) {
    return null
  }
  // Why: the forced tour's split action targets the visible terminal tab.
  // Worktree activation can restore an editor/browser as the active surface.
  state.setActiveTabType('terminal')
  state.setActiveTab(tabId)
  focusTerminalTabSurface(tabId)
  return tabId
}

function useSecondPaneTarget(worktreeId: string | null): { tabId: string; leafId: string } | null {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  return useMemo(() => {
    if (!worktreeId) {
      return null
    }
    const tabIds = (tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
    const orderedTabIds =
      activeTabId && tabIds.includes(activeTabId)
        ? [activeTabId, ...tabIds.filter((tabId) => tabId !== activeTabId)]
        : tabIds
    for (const tabId of orderedTabIds) {
      const root = terminalLayoutsByTabId[tabId]?.root
      const secondLeafId = getSecondSplitLeafId(root)
      if (secondLeafId) {
        return { tabId, leafId: secondLeafId }
      }
    }
    return null
  }, [activeTabId, tabsByWorktree, terminalLayoutsByTabId, worktreeId])
}

function getSecondSplitLeafId(node: TerminalPaneLayoutNode | null | undefined): string | null {
  if (!node || node.type === 'leaf') {
    return null
  }
  return getLeftmostLeafId(node.second)
}

function getLeftmostLeafId(node: TerminalPaneLayoutNode): string {
  return node.type === 'leaf' ? node.leafId : getLeftmostLeafId(node.first)
}

let pendingSetupGuideTourCancel: (() => void) | null = null
let pendingSetupGuideFrame: number | null = null
let setupGuideTourRequestSequence = 0

function createSetupGuideTourRequestId(): string {
  setupGuideTourRequestSequence += 1
  return `setup-guide-tour-${setupGuideTourRequestSequence}`
}

export function cancelPendingSetupGuideTourRequest(): void {
  pendingSetupGuideTourCancel?.()
  pendingSetupGuideTourCancel = null
  if (pendingSetupGuideFrame !== null) {
    window.cancelAnimationFrame(pendingSetupGuideFrame)
    pendingSetupGuideFrame = null
  }
}

export function requestSetupGuideTourWhenReady(args: RequestContextualTourWhenReadyArgs): void {
  cancelPendingSetupGuideTourRequest()
  pendingSetupGuideTourCancel = requestContextualTourWhenReady(args)
}

export function requestSetupGuideTourAfterFrame(callback: () => void): void {
  cancelPendingSetupGuideTourRequest()
  pendingSetupGuideFrame = window.requestAnimationFrame(() => {
    pendingSetupGuideFrame = null
    callback()
  })
}

export function isSetupGuideWorkspaceComposerRequestCurrent(requestId: string): boolean {
  const state = useAppStore.getState()
  const modalData = state.modalData as { setupGuideTourRequestId?: unknown }
  return (
    state.activeModal === 'new-workspace-composer' &&
    modalData.setupGuideTourRequestId === requestId
  )
}

function isWorktreeTerminalStillCurrent(worktreeId: string): boolean {
  const state = useAppStore.getState()
  return (
    state.activeModal === 'none' &&
    state.activeWorktreeId === worktreeId &&
    state.activeView === 'terminal' &&
    state.activeTabType === 'terminal'
  )
}
