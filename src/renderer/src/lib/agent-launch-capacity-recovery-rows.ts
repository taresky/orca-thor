// Pure view-model for the capacity-recovery sheet: turns a host-redacted
// PendingAgentLaunchSummaryRow into a display shape + the one action a client
// may take on it. Store/IPC-free so it unit-tests without a renderer; the sheet
// component translates the label ids and dispatches the resolved action.

import type {
  PendingAgentLaunchSummaryRow,
  PendingAgentLaunchLiveness
} from '../../../shared/agent-launch-pending-summary'
import type { AgentLaunchIntentKind } from '../../../shared/agent-launch-contract'

/** The single action a client may take on a pending-launch row. Only a worktree
 *  owner is routable today; session/run/task owners deep-link once their
 *  producers land (U5/U6/U9), and an ownerless direct/session row (which would
 *  offer explicit Forget) is not admitted yet, so both resolve to `null`. */
export type CapacityRecoveryRowAction = { kind: 'open-worktree'; worktreeId: string }

export type CapacityRecoveryRowView = {
  sourceKind: AgentLaunchIntentKind
  hostDisplayName: string
  admittedAt: number
  liveness: PendingAgentLaunchLiveness
  action: CapacityRecoveryRowAction | null
}

/** Resolve the routable action for a row. A worktree deep link opens the owning
 *  workspace (live rows reveal the terminal; absent/unknown rows land on its
 *  recovery card). Every other owner kind is not routable yet. */
export function resolveCapacityRowAction(
  row: PendingAgentLaunchSummaryRow
): CapacityRecoveryRowAction | null {
  if (row.deepLink?.kind === 'worktree') {
    return { kind: 'open-worktree', worktreeId: row.deepLink.worktreeId }
  }
  return null
}

export function toCapacityRecoveryRowView(
  row: PendingAgentLaunchSummaryRow
): CapacityRecoveryRowView {
  return {
    sourceKind: row.sourceKind,
    hostDisplayName: row.targetHostDisplayName,
    admittedAt: row.admittedAt,
    liveness: row.liveness,
    action: resolveCapacityRowAction(row)
  }
}

/** i18n key + English fallback for a launch's source kind. */
export function sourceKindCopy(kind: AgentLaunchIntentKind): { key: string; fallback: string } {
  switch (kind) {
    case 'interactive':
      return { key: 'agentLaunch.capacity.source.interactive', fallback: 'Workspace' }
    case 'cli':
      return { key: 'agentLaunch.capacity.source.cli', fallback: 'CLI' }
    case 'automation':
      return { key: 'agentLaunch.capacity.source.automation', fallback: 'Automation' }
    case 'background':
      return { key: 'agentLaunch.capacity.source.background', fallback: 'Background' }
    case 'orchestration':
      return { key: 'agentLaunch.capacity.source.orchestration', fallback: 'Orchestration' }
    case 'resume':
      return { key: 'agentLaunch.capacity.source.resume', fallback: 'Resume' }
  }
}

/** i18n key + English fallback for a row's liveness badge. */
export function livenessCopy(liveness: PendingAgentLaunchLiveness): {
  key: string
  fallback: string
} {
  switch (liveness) {
    case 'live':
      return { key: 'agentLaunch.capacity.liveness.live', fallback: 'Running' }
    case 'absent':
      return { key: 'agentLaunch.capacity.liveness.absent', fallback: 'Not running' }
    case 'unknown':
      return { key: 'agentLaunch.capacity.liveness.unknown', fallback: 'Unreachable' }
  }
}
