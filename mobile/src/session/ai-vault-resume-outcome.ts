import type {
  AgentLaunchFailureCode,
  AgentLaunchNoticeCode
} from '../../../src/shared/agent-launch-contract'

// Domain outcome of a host-owned mobile resume, kept independent of the RPC
// envelope so the user-facing model stays stable while the transport shape is
// still settling. The flip wires wave2-host's createTerminal response into this.
export type MobileResumeOutcome =
  | { kind: 'launched'; notices?: readonly AgentLaunchNoticeCode[] }
  | { kind: 'failed'; code: AgentLaunchFailureCode }

// invalid_launch_snapshot is the only resume outcome that demands an explicit
// user choice: the saved launch details are gone, so the user opts in to a
// current-settings launch instead of a silent re-derivation (plan §570).
export type MobileResumeAffordance = {
  id: 'launch-current-settings'
  label: string
}

export type MobileResumeOutcomeDisplay = {
  tone: 'success' | 'info' | 'error'
  message: string
  action?: MobileResumeAffordance
}

const LAUNCH_CURRENT_SETTINGS: MobileResumeAffordance = {
  id: 'launch-current-settings',
  label: 'Launch with current settings'
}

export function resolveMobileResumeOutcomeDisplay(
  outcome: MobileResumeOutcome
): MobileResumeOutcomeDisplay {
  if (outcome.kind === 'failed') {
    if (outcome.code === 'invalid_launch_snapshot') {
      return {
        tone: 'error',
        message: 'This session was saved with launch settings that are no longer available.',
        action: LAUNCH_CURRENT_SETTINGS
      }
    }
    return { tone: 'error', message: "Couldn't resume this session." }
  }
  const notices = outcome.notices ?? []
  const parts: string[] = []
  if (notices.includes('env_withheld')) {
    parts.push(
      "This launch didn't use all of the saved environment values. Manage paired-launch env on the desktop host."
    )
  }
  // Value-neutral by ruling: on mobile/paired snapshot_definition_changed can
  // only stem from label/argument/env-policy changes, never env-value changes.
  if (notices.includes('snapshot_definition_changed')) {
    parts.push('Resumed with the settings saved when this session started.')
  }
  if (parts.length === 0) {
    return { tone: 'success', message: 'Agent session queued.' }
  }
  return { tone: 'info', message: parts.join(' ') }
}
