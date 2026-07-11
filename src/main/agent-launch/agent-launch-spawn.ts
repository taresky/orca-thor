// Host adapter that turns a client `agentLaunch` request into a resolved startup
// plan + receipt through the launch boundary (U3). The client request names only
// the agent identity and prompt: this module builds the ResolveAgentLaunchRequest
// entirely from HOST state (settings, normalized catalog, detection, derived
// target) and NEVER reads a client command/launchConfig/launchAgent/env — those
// fields have no representation in AgentLaunchSpawnInput. Intent is constructed
// host-side; the reference authority is derived here, not copied from the client.

import type { GlobalSettings, BuiltInTuiAgent } from '../../shared/types'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import type { AgentStartupPlan } from '../../shared/tui-agent-startup'
import type {
  AgentLaunchReceipt,
  AgentLaunchFailure,
  AgentLaunchRequestError
} from '../../shared/agent-launch-contract'
import type {
  AgentLaunchExecutionHostId,
  AgentLaunchSnapshot,
  AgentReferenceAuthority,
  LaunchIntent,
  ResolvedAgentLaunch
} from '../../shared/agent-launch-host-contract'
import type { AgentLaunchSpawnRequest } from '../../shared/agent-launch-spawn-request'
import { normalizeCatalogFromSettings } from './agent-catalog-projections'
import { resolveAgentLaunch, type ResolveAgentLaunchOutcome } from './resolve-agent-launch'
import type { AgentLaunchBoundary, HostStateResolution } from './agent-launch-boundary'
import type { AdmissionPrincipal } from './agent-launch-admission-store'

export type AgentLaunchSpawnTarget = {
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  isRemote: boolean
  executionHostId: AgentLaunchExecutionHostId
  targetHomePath?: string | null
  /** null = detection unavailable (unknown); never claims "not installed". */
  detectedStockBaseAgents?: ReadonlySet<BuiltInTuiAgent> | null
  transportConfidentialityAvailable?: boolean
}

export type AgentLaunchSpawnDeps = {
  getSettings: () => GlobalSettings
  getCatalogRevision: () => number
  boundary: AgentLaunchBoundary
  preflight?: (launch: ResolvedAgentLaunch) => Promise<void> | void
  prepareEnv?: (launch: ResolvedAgentLaunch) => Promise<void> | void
  /** Injectable for tests; defaults to the real total resolver. */
  resolve?: typeof resolveAgentLaunch
}

export type AgentLaunchSpawnInput = {
  request: AgentLaunchSpawnRequest
  intent: LaunchIntent
  target: AgentLaunchSpawnTarget
  variables: { repoPath?: string | null; worktreePath?: string | null }
  scope: string
  principal: AdmissionPrincipal
  persistedSnapshot?: AgentLaunchSnapshot
}

export type AgentLaunchSpawnResolution =
  | { ok: true; plan: AgentStartupPlan; receipt: AgentLaunchReceipt }
  | { ok: false; failure: AgentLaunchFailure }
  | { ok: false; requestError: AgentLaunchRequestError }

/** Derive the reference authority host-side from the requested selection and any
 *  host-verified saved owner. A live selection cannot forge persisted fallback
 *  authority; that requires a validated sourceRecord owner. */
function referenceFor(request: AgentLaunchSpawnRequest): AgentReferenceAuthority {
  if (request.selection.kind === 'default') {
    return { kind: 'persisted', owner: 'default' }
  }
  if (request.sourceRecord) {
    return { kind: 'persisted', owner: request.sourceRecord.owner }
  }
  return { kind: 'live-selection' }
}

/** Resolve a client agentLaunch request into a startup plan + receipt, or a
 *  typed failure/request-error. Creates no PTY: the caller owns spawning. */
export async function resolveAgentLaunchSpawn(
  deps: AgentLaunchSpawnDeps,
  input: AgentLaunchSpawnInput
): Promise<AgentLaunchSpawnResolution> {
  const resolveFn = deps.resolve ?? resolveAgentLaunch
  const reference = referenceFor(input.request)

  const resolve = (): HostStateResolution => {
    const settings = deps.getSettings()
    const catalog = normalizeCatalogFromSettings(settings)
    const outcome: ResolveAgentLaunchOutcome = resolveFn(
      {
        selection: input.request.selection,
        intent: input.intent,
        reference,
        variables: input.variables,
        platform: input.target.platform,
        ...(input.target.shell ? { shell: input.target.shell } : {}),
        isRemote: input.target.isRemote,
        targetHomePath: input.target.targetHomePath ?? null,
        detectedStockBaseAgents: input.target.detectedStockBaseAgents ?? null,
        executionHostId: input.target.executionHostId,
        ...(input.target.transportConfidentialityAvailable !== undefined
          ? { transportConfidentialityAvailable: input.target.transportConfidentialityAvailable }
          : {}),
        ...(input.persistedSnapshot ? { persistedSnapshot: input.persistedSnapshot } : {})
      },
      catalog,
      settings
    )
    return { outcome, catalogRevision: deps.getCatalogRevision() }
  }

  return deps.boundary.executeAgentLaunch({
    scope: input.scope,
    principal: input.principal,
    resolve,
    prompt: input.request.prompt ?? '',
    ...(input.request.allowEmptyPromptLaunch !== undefined
      ? { allowEmptyPromptLaunch: input.request.allowEmptyPromptLaunch }
      : {}),
    ...(deps.preflight ? { preflight: deps.preflight } : {}),
    ...(deps.prepareEnv ? { prepareEnv: deps.prepareEnv } : {})
  })
}
