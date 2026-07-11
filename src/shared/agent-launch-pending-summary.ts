// Client-safe capacity-recovery sheet DTO. One redacted row per pending admitted
// launch the authenticated principal owns: source kind, base harness, target-host
// display name, admitted time, liveness, and an owner deep link when one exists.
// Secret-free by construction — it never carries a prompt, custom agent id/label,
// argv, path, launch token, or env presence/key/value, nor another principal's
// row. The host keeps the launch token private (used only for the liveness scan).

import type { AgentLaunchIntentKind } from './agent-launch-contract'
import type { BuiltInTuiAgent } from './types'

/** Liveness of a pending launch's owning terminal. `absent` is authoritative only
 *  when the host can list the owner (local terminals die with main); a possibly
 *  unreachable remote host reports `unknown` rather than a false `absent`. */
export type PendingAgentLaunchLiveness = 'live' | 'absent' | 'unknown'

/** Owner reference the client routes to the owning recovery surface. Carries only
 *  the owner kind + owner id — never a path, prompt, agent id/label, or token. */
export type PendingAgentLaunchDeepLink =
  | { kind: 'worktree'; worktreeId: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'task'; taskId: string }

export type PendingAgentLaunchSummaryRow = {
  sourceKind: AgentLaunchIntentKind
  baseHarness: BuiltInTuiAgent
  targetHostDisplayName: string
  admittedAt: number
  liveness: PendingAgentLaunchLiveness
  deepLink?: PendingAgentLaunchDeepLink
}

export type PendingAgentLaunchSummary = {
  rows: readonly PendingAgentLaunchSummaryRow[]
}
