// Client-safe nested `agentLaunch` request carried by pty:spawn IPC and the
// terminal-create RPC schemas (U3). It names only the requested agent identity
// and the interactive prompt/launch policy — never a command, env, launch
// config, or resolved argv. When present, the host IGNORES any client-supplied
// command/launchConfig/launchAgent/env and resolves the launch itself through
// the host boundary. The host constructs LaunchIntent/AgentReferenceAuthority
// from its authenticated context; this shape never carries either.

import type { TuiAgent } from './types'

/** Requested agent identity, or the host's stored default. A custom id is only
 *  admitted on THIS field, never the legacy launchAgent field. */
export type AgentLaunchSelectionRequest = { kind: 'agent'; agent: TuiAgent } | { kind: 'default' }

/** Names a host-verified saved owner whose stored prompt/reference authority a
 *  launch may use. Clients supply the owner locator only; the host validates it
 *  and classifies prompt authority. The full mobile/paired variant set lands
 *  with U7's host-owned mobile launch — Wave 1 accepts the owner locator shape
 *  so the wire contract is stable. */
export type AgentLaunchSourceRecord = {
  owner:
    | 'default'
    | 'quick-command'
    | 'commit-message'
    | 'source-control-recipe'
    | 'session'
    | 'workspace'
  id?: string
}

export type AgentLaunchSpawnRequest = {
  selection: AgentLaunchSelectionRequest
  /** Current interactive draft; the host applies its per-surface maximum. */
  prompt?: string
  /** Launch a bare TUI when the prompt is empty (e.g. tab.newAgent). */
  allowEmptyPromptLaunch?: boolean
  sourceRecord?: AgentLaunchSourceRecord
}
