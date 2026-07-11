// Host resolution of a runtime terminal's `agentLaunch` request (U3). Wraps the
// shared host-state derivation and launch boundary for the terminal-create
// surfaces (terminal.create, session.tabs.createTerminal): it injects on-demand
// stock detection and the target home per execution host, marks workspace trust
// through the boundary's pre-admission preflight hook (driven by the resolved
// policy.preflightTrust, best-effort), and maps the admitted plan to the terminal
// option fields the spawn path consumes. The client's command/env/launchConfig/
// launchAgent are IGNORED here — this is a security boundary on the untrusted RPC
// surface: only the host-resolved plan spawns. Electron-free and injection-based
// so it is unit-testable.

import type { BuiltInTuiAgent, GlobalSettings } from '../../shared/types'
import type { AgentLaunchReceipt } from '../../shared/agent-launch-contract'
import type {
  AgentLaunchSpawnOutcome,
  AgentLaunchSpawnRequest
} from '../../shared/agent-launch-spawn-request'
import type { ResolvedAgentLaunch } from '../../shared/agent-launch-host-contract'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import type { StartupCommandDelivery } from '../../shared/codex-startup-delivery'
import {
  deriveAgentLaunchHostState,
  type AgentLaunchHostDescriptor
} from '../agent-launch/agent-launch-host-state'
import { resolveAgentLaunchSpawn } from '../agent-launch/agent-launch-spawn'
import type { resolveAgentLaunch } from '../agent-launch/resolve-agent-launch'
import type {
  AgentLaunchBoundary,
  AuthenticatedClientKind
} from '../agent-launch/agent-launch-boundary'
import { mapClientKindToLaunchClient } from '../agent-launch/agent-launch-boundary'
import type { AdmissionPrincipal } from '../agent-launch/agent-launch-admission-store'

/** The host-resolved fields a terminal spawn consumes. The launchAgent is the
 *  BUILT-IN base (expectedProcess/telemetry are built-in-keyed); the requested
 *  identity travels in the receipt. */
export type ResolvedTerminalLaunchFields = {
  command: string
  env?: Record<string, string>
  launchConfig: SleepingAgentLaunchConfig
  launchAgent: BuiltInTuiAgent
  launchToken: string
  startupCommandDelivery?: StartupCommandDelivery
}

/** A pre-spawn typed failure/rejection: NO terminal is created and — for the RPC
 *  surfaces — this is a successful response, not an error envelope. */
export type TerminalAgentLaunchFailure = Extract<
  AgentLaunchSpawnOutcome,
  { status: 'failed' | 'rejected' }
>

export type TerminalAgentLaunchResolution =
  | {
      kind: 'resolved'
      fields: ResolvedTerminalLaunchFields
      admissionToken: string
      receipt: AgentLaunchReceipt
    }
  | { kind: 'failed'; outcome: TerminalAgentLaunchFailure }

export type TerminalAgentLaunchDeps = {
  boundary: AgentLaunchBoundary
  getSettings: () => GlobalSettings
  getCatalogRevision: () => number
  detectStockBaseAgents: (
    descriptor: AgentLaunchHostDescriptor
  ) => Promise<readonly string[] | null>
  resolveTargetHomePath: (descriptor: AgentLaunchHostDescriptor) => Promise<string | null>
  /** Best-effort workspace trust for the resolved base agent, run as the
   *  boundary's pre-admission preflight. Must not throw for a routine no-trust
   *  agent; a throw maps to trust_preflight_failed with no admission record. */
  markWorkspaceTrusted: (launch: ResolvedAgentLaunch) => Promise<void> | void
  /** Injectable total resolver for tests; defaults to the real one. */
  resolve?: typeof resolveAgentLaunch
}

export type TerminalAgentLaunchArgs = {
  request: AgentLaunchSpawnRequest
  clientKind: AuthenticatedClientKind
  descriptor: AgentLaunchHostDescriptor
  scope: string
  worktreePath: string | null
  repoPath: string | null
  principal: AdmissionPrincipal
}

/** Resolve a terminal `agentLaunch` request into host-resolved spawn fields plus
 *  the admission token (settle after registration) and receipt, or a typed
 *  failure. Creates no terminal: the caller owns spawning + settlement. */
export async function resolveTerminalAgentLaunch(
  deps: TerminalAgentLaunchDeps,
  args: TerminalAgentLaunchArgs
): Promise<TerminalAgentLaunchResolution> {
  const hostState = await deriveAgentLaunchHostState(
    {
      getSettings: deps.getSettings,
      getCatalogRevision: deps.getCatalogRevision,
      detectStockBaseAgents: deps.detectStockBaseAgents,
      resolveTargetHomePath: deps.resolveTargetHomePath
    },
    args.descriptor,
    { worktreePath: args.worktreePath, repoPath: args.repoPath }
  )
  const resolution = await resolveAgentLaunchSpawn(
    {
      getSettings: hostState.getSettings,
      getCatalogRevision: hostState.getCatalogRevision,
      boundary: deps.boundary,
      preflight: deps.markWorkspaceTrusted,
      ...(deps.resolve ? { resolve: deps.resolve } : {})
    },
    {
      request: args.request,
      intent: { kind: 'interactive', client: mapClientKindToLaunchClient(args.clientKind) },
      target: hostState.target,
      variables: hostState.variables,
      scope: args.scope,
      principal: args.principal
    }
  )
  if (!resolution.ok) {
    return {
      kind: 'failed',
      outcome:
        'failure' in resolution
          ? { status: 'failed', failure: resolution.failure }
          : { status: 'rejected', requestError: resolution.requestError }
    }
  }
  return {
    kind: 'resolved',
    admissionToken: resolution.receipt.launchToken,
    receipt: resolution.receipt,
    fields: {
      command: resolution.plan.launchCommand,
      ...(resolution.plan.env ? { env: resolution.plan.env } : {}),
      launchConfig: resolution.plan.launchConfig,
      launchAgent: resolution.receipt.baseAgent,
      launchToken: resolution.receipt.launchToken,
      ...(resolution.plan.startupCommandDelivery !== undefined
        ? { startupCommandDelivery: resolution.plan.startupCommandDelivery }
        : {})
    }
  }
}
