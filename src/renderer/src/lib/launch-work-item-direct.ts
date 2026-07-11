import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { isTuiAgentEnabled, pickTuiAgent } from '../../../shared/tui-agent-selection'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { getWorkspaceIntentName, getWorkspaceSeedName } from '@/lib/new-workspace'
import {
  gitLabIssueNumber,
  resolvePrHeadErrorMessage,
  unavailableAgentErrorMessage,
  workspaceActivationErrorMessage
} from '@/lib/launch-work-item-direct-messages'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { getConnectionId } from '@/lib/connection-context'
import type { GitPushTarget, SetupDecision, TuiAgent } from '../../../shared/types'
import { getLinearIssueWorkspaceName } from '../../../shared/workspace-name'
import { resolveGitHubWorkItemIdentity } from '@/lib/github-work-item-identity'
import {
  agentLaunchFailureMessage,
  agentLaunchRequestErrorMessage
} from '@/lib/agent-launch-failure-copy'
import { buildDirectWorkItemAgentLaunchStartup } from '@/lib/launch-work-item-direct-agent'
import { getDirectWorkItemDraftContent } from '@/lib/launch-work-item-direct-draft'
import {
  resolveDirectPrStartPoint,
  resolveDirectSetupDecision
} from '@/lib/launch-work-item-direct-preflight'
import type { LaunchWorkItemDirectArgs } from '@/lib/launch-work-item-direct-types'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'

/**
 * "Use" flow: create the workspace, activate it, and launch the default agent
 * with the work item context. Most callers land it as a draft; fix-check
 * launches can opt into submitting the prompt after the TUI is ready.
 * Falls back to `openModalFallback()` when:
 *   - the repo's `setupRunPolicy` is `'ask'` (the user must pick per-workspace)
 *   - the repo can't be resolved from `repoId`
 *   - no compatible agent is detected on PATH
 *
 * The agent launch is identity-only: the renderer owns the primary tab the
 * activation seeds, and the host resolves the command/config/env and delivers
 * the prompt (folding it into the launch or returning it for the readiness-gated
 * paste writer). The client never assembles a command, args, or env.
 *
 * Best-effort: after workspace activation, the launch is queued on the primary
 * tab — the user still has a usable workspace even if the agent fails to start.
 */
export async function launchWorkItemDirect(args: LaunchWorkItemDirectArgs): Promise<boolean> {
  const {
    item,
    repoId,
    openModalFallback,
    baseBranch,
    telemetrySource,
    launchSource,
    agentOverride
  } = args
  const store = useAppStore.getState()
  const repo = store.repos.find((r) => r.id === repoId)
  if (!repo) {
    openModalFallback()
    return false
  }

  const settings = store.settings
  // Why: preflight (PR base + hooks probe) must run on the repo's owner host so it
  // matches the owner-routed createWorktree below, not the focused runtime.
  const repoOwnerSettings = getSettingsForRepoRuntimeOwner(store, repoId)
  const promptDelivery = args.promptDelivery ?? 'draft'
  const repoConnectionId = repo.connectionId?.trim() || null
  const githubIdentity =
    item.number !== null && (item.type === 'issue' || item.type === 'pr')
      ? resolveGitHubWorkItemIdentity({
          type: item.type,
          number: item.number,
          url: item.url
        })
      : null
  const itemType = githubIdentity?.type ?? item.type
  const itemNumber = githubIdentity?.number ?? item.number
  // Why: agent detection shells out and can be cold/slow. Start it now, but
  // don't let it serialize setup-policy resolution or git worktree creation.
  const detectedAgentsPromise = agentOverride
    ? null
    : repoConnectionId
      ? store.ensureRemoteDetectedAgents(repoConnectionId)
      : store.ensureDetectedAgents()

  const setupResolution = await resolveDirectSetupDecision(repoId, repo, repoOwnerSettings)
  if (setupResolution.kind === 'needs-modal') {
    openModalFallback()
    return false
  }

  const trustDecision = await ensureHooksConfirmed(useAppStore.getState(), repoId, 'setup')
  const finalSetupDecision: SetupDecision =
    trustDecision === 'skip' ? 'skip' : setupResolution.decision

  const workspaceIntentName =
    itemNumber !== null
      ? getWorkspaceIntentName({
          sourceText: item.pasteContent,
          workItem: { ...item, type: itemType, number: itemNumber }
        })
      : null
  const workspaceName = getWorkspaceSeedName({
    explicitName: item.linearIdentifier
      ? getLinearIssueWorkspaceName({ identifier: item.linearIdentifier, title: item.title })
      : (workspaceIntentName?.seedName ?? ''),
    prompt: '',
    linkedIssueNumber: itemType === 'issue' ? (itemNumber ?? null) : null,
    linkedPR: itemType === 'pr' ? (itemNumber ?? null) : null
  })
  let resolvedBaseBranch = baseBranch
  let resolvedPushTarget: GitPushTarget | undefined
  let resolvedBranchNameOverride: string | undefined
  let resolvedCompareBaseRef: string | undefined
  if (!resolvedBaseBranch && itemType === 'pr' && itemNumber) {
    try {
      // Why: direct "Use PR" launches bypass the Start-from picker, so they
      // must still resolve the PR head before `git worktree add`.
      const result = await resolveDirectPrStartPoint(repoId, itemNumber, repoOwnerSettings, item)
      resolvedBaseBranch = result.baseBranch
      resolvedPushTarget = result.pushTarget
      resolvedBranchNameOverride = result.branchNameOverride
      resolvedCompareBaseRef = result.compareBaseRef
    } catch (error) {
      toast.error(error instanceof Error ? error.message : resolvePrHeadErrorMessage())
      openModalFallback()
      return false
    }
  }

  let worktreeId: string
  let effectiveAgent: TuiAgent | null = null
  const draftContent = await getDirectWorkItemDraftContent(item, repoConnectionId)
  try {
    const result = await store.createWorktree(
      repoId,
      workspaceName,
      resolvedBaseBranch,
      finalSetupDecision,
      undefined,
      telemetrySource,
      workspaceIntentName?.displayName ?? item.title,
      itemType === 'issue' && itemNumber ? itemNumber : undefined,
      itemType === 'pr' && itemNumber ? itemNumber : undefined,
      resolvedPushTarget,
      undefined,
      item.linearIdentifier,
      resolvedBranchNameOverride,
      undefined,
      itemType === 'mr' && itemNumber ? itemNumber : undefined,
      gitLabIssueNumber({ ...item, type: itemType, number: itemNumber }),
      undefined,
      undefined,
      undefined,
      item.linearWorkspaceId,
      item.linearOrganizationUrlKey,
      undefined,
      undefined,
      undefined,
      resolvedCompareBaseRef
    )
    // A pre-create agent-launch rejection created no worktree; surface the
    // client-safe recovery copy and abort without a substitute workspace.
    if (result.created === false) {
      const rejection = result.agentLaunchResult
      toast.error(
        rejection.status === 'failed'
          ? agentLaunchFailureMessage(rejection.failure)
          : agentLaunchRequestErrorMessage(rejection.requestError)
      )
      return false
    }
    worktreeId = result.worktree.id
    const worktreePath = result.worktree.path

    const createdConnectionId = getConnectionId(worktreeId)
    // Why: newly-created SSH worktrees can be activated before the store
    // rehydrates their repo link; preserve the source repo connection.
    const launchConnectionId = createdConnectionId ?? repoConnectionId
    const latestStore = useAppStore.getState()
    if (agentOverride) {
      const detectedAgents =
        typeof launchConnectionId === 'string'
          ? await latestStore.ensureRemoteDetectedAgents(launchConnectionId)
          : await latestStore.ensureDetectedAgents()
      if (
        !detectedAgents.includes(agentOverride) ||
        !isTuiAgentEnabled(agentOverride, latestStore.settings?.disabledTuiAgents)
      ) {
        activateAndRevealWorktree(worktreeId, {
          sidebarRevealBehavior: 'auto',
          setup: result.setup
        })
        toast.error(unavailableAgentErrorMessage())
        return false
      }
      effectiveAgent = agentOverride
    } else {
      const detectedAgents =
        launchConnectionId === repoConnectionId
          ? await detectedAgentsPromise!
          : typeof launchConnectionId === 'string'
            ? await latestStore.ensureRemoteDetectedAgents(launchConnectionId)
            : await latestStore.ensureDetectedAgents()
      const detectedIds = new Set(detectedAgents)
      effectiveAgent = pickTuiAgent(
        settings?.defaultTuiAgent,
        detectedIds,
        settings?.disabledTuiAgents
      )
    }
    if (effectiveAgent) {
      // Why: direct task launch creates and starts the workspace in separate
      // steps so agent detection can overlap git worktree creation. Persist
      // the chosen agent once known so empty-worktree reopen can recreate it.
      void store.updateWorktreeMeta(worktreeId, { createdWithAgent: effectiveAgent }).catch(() => {
        // Non-critical: activation still has the explicit startup below.
      })
    }
    // Why: agents that gate first-launch behind a "Do you trust this folder?"
    // menu (cursor-agent, copilot) consume the bracketed paste as menu input.
    // Pre-write the same trust artifact those CLIs write after the user
    // accepts so the menu never fires. Best-effort — main swallows errors,
    // and we guard the IPC presence so a stale preload bundle (which can
    // ship a renderer that's ahead of the loaded preload) doesn't crash the
    // launch with "Cannot read properties of undefined".
    if (effectiveAgent && worktreePath && window.api.agentTrust?.markTrusted) {
      const preflight = TUI_AGENT_CONFIG[effectiveAgent].preflightTrust
      if (preflight) {
        try {
          await window.api.agentTrust.markTrusted({
            preset: preflight,
            workspacePath: worktreePath,
            ...(repo.connectionId ? { connectionId: repo.connectionId } : {})
          })
        } catch {
          // Best-effort: continue with launch even if the trust write
          // throws. The user can dismiss the trust menu manually.
        }
      }
    }

    const activation = activateAndRevealWorktree(worktreeId, {
      sidebarRevealBehavior: 'auto',
      setup: result.setup,
      defaultTabs: result.defaultTabs,
      ...(effectiveAgent
        ? {
            startup: buildDirectWorkItemAgentLaunchStartup({
              agent: effectiveAgent,
              draftContent,
              promptDelivery,
              launchSource
            })
          }
        : {})
    })
    if (!activation) {
      // Worktree vanished between create and activate — extremely unlikely but
      // worth handling explicitly rather than silently dropping the draft.
      toast.error(workspaceActivationErrorMessage())
      return false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create workspace.'
    toast.error(message)
    return false
  }

  store.setSidebarOpen(true)

  // The workspace is live and, when an agent was resolved, its identity-only
  // launch is queued on the activation's primary tab. The host owns prompt
  // delivery on that spawn — folding the draft into the launch or returning it
  // for the pty-connection paste writer — so the renderer does not paste here.
  return true
}
