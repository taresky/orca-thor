// The single host boundary every agent spawn routes through (U3). It sequences
// the launch pipeline exactly per plan §3's admission paragraph: resolve once
// from an atomic host view, run trust/provider-env preparation OUTSIDE the
// admission coordinator, then INSIDE the coordinator re-take the host view,
// recompute the relevant-input fingerprint, and commit the admitted token/
// snapshot before any provider I/O. The startup plan is built from the ORIGINAL
// resolved launch: admission commits that snapshot and later edits affect only
// future launches. Dependency-injected and electron-free so it is unit-testable.

import type {
  AgentLaunchAdmissionStore,
  AdmissionPrincipal,
  AdmittedLaunchRecord,
  LaunchAdmissionCoordinator
} from './agent-launch-admission-store'
import type { ResolveAgentLaunchOutcome } from './resolve-agent-launch'
import type { ResolvedAgentLaunch } from '../../shared/agent-launch-host-contract'
import type {
  AgentLaunchFailure,
  AgentLaunchNotice,
  AgentLaunchReceipt,
  AgentLaunchRequestError
} from '../../shared/agent-launch-contract'
import type { AgentStartupPlan } from '../../shared/tui-agent-startup'
import { buildAgentStartupPlanFromResolvedLaunch } from '../../shared/resolved-agent-startup-plan'

/** Authenticated RPC client kind. `undefined` is an in-process/host caller —
 *  desktop, never mobile by guesswork. Never copied from client JSON. */
export type AuthenticatedClientKind = 'runtime' | 'mobile' | undefined

/** Map the authenticated RPC scope to the launch-intent client. Callers build
 *  their interactive/resume LaunchIntent host-side with this — the boundary's
 *  intent construction lives here so no path derives it from client payload. */
export function mapClientKindToLaunchClient(
  kind: AuthenticatedClientKind
): 'desktop' | 'paired-web' | 'mobile' {
  if (kind === 'runtime') {
    return 'paired-web'
  }
  if (kind === 'mobile') {
    return 'mobile'
  }
  return 'desktop'
}

/** One resolution against the current atomic host state view (settings +
 *  normalized catalog + detection snapshot + derived target). The caller closes
 *  over the fixed request (selection/intent/reference/variables/target) and
 *  re-reads volatile host state on each call; it performs no async I/O so it is
 *  safe to invoke inside the coordinator's critical section. */
export type HostStateResolution = {
  outcome: ResolveAgentLaunchOutcome
  catalogRevision: number
}

export type ExecuteAgentLaunchArgs = {
  /** Owner scope for reconciliation joins (worktree id, pane key, run id …). */
  scope: string
  principal: AdmissionPrincipal
  /** Re-resolve from a fresh atomic host view. Called once before admission and
   *  once inside the coordinator; both re-read settings. */
  resolve: () => HostStateResolution
  prompt: string
  allowEmptyPromptLaunch?: boolean
  /** Trust preflight, OUTSIDE the coordinator. A throw maps to
   *  trust_preflight_failed and commits no admission record. */
  preflight?: (launch: ResolvedAgentLaunch) => Promise<void> | void
  /** Provider env preparation, OUTSIDE the coordinator. Same failure mapping as
   *  preflight: a pre-spawn preparation throw is a trust_preflight_failed with
   *  no admission record (no dedicated failure code exists for this phase). */
  prepareEnv?: (launch: ResolvedAgentLaunch) => Promise<void> | void
  now?: () => number
}

export type ExecuteAgentLaunchResult =
  | { ok: true; plan: AgentStartupPlan; receipt: AgentLaunchReceipt }
  | { ok: false; failure: AgentLaunchFailure }
  | { ok: false; requestError: AgentLaunchRequestError }

/** Terminal outcome the caller boundary reports back so admission moves or
 *  releases: `registered` keeps a private reconciliation handoff record, while
 *  `failed` releases the reservation entirely. */
export type LaunchSettlement = 'registered' | 'failed'

type CriticalResult =
  | { kind: 'admitted'; record: AdmittedLaunchRecord; catalogRevision: number }
  | { kind: 'failure'; failure: AgentLaunchFailure }
  | { kind: 'requestError'; requestError: AgentLaunchRequestError }

function dedupeNoticesByCode(notices: readonly AgentLaunchNotice[]): AgentLaunchNotice[] {
  const seen = new Set<string>()
  const deduped: AgentLaunchNotice[] = []
  for (const notice of notices) {
    if (!seen.has(notice.code)) {
      seen.add(notice.code)
      deduped.push(notice)
    }
  }
  return deduped
}

/** Map a re-resolve mismatch inside the coordinator: a newly disabled base is
 *  base_agent_disabled; any other relevant change is agent_configuration_changed.
 *  The fingerprint only hashes relevant inputs, so an unrelated catalog edit does
 *  not reach this path. */
function mapAdmissionMismatch(failure: AgentLaunchFailure): AgentLaunchFailure {
  if (failure.code === 'base_agent_disabled') {
    return failure
  }
  return {
    code: 'agent_configuration_changed',
    ...(failure.requestedAgent ? { requestedAgent: failure.requestedAgent } : {}),
    ...(failure.baseAgent ? { baseAgent: failure.baseAgent } : {})
  }
}

export class AgentLaunchBoundary {
  private readonly admissionStore: AgentLaunchAdmissionStore
  private readonly coordinator: LaunchAdmissionCoordinator
  private readonly now: () => number
  /** Private reconciliation handoff for registered launches; U4 replaces this
   *  with the durable operation ledger. Never serialized to clients/logs. */
  private readonly retained = new Map<string, AdmittedLaunchRecord>()

  constructor(deps: {
    admissionStore: AgentLaunchAdmissionStore
    coordinator: LaunchAdmissionCoordinator
    now?: () => number
  }) {
    this.admissionStore = deps.admissionStore
    this.coordinator = deps.coordinator
    this.now = deps.now ?? (() => Date.now())
  }

  async executeAgentLaunch(args: ExecuteAgentLaunchArgs): Promise<ExecuteAgentLaunchResult> {
    const nowFn = args.now ?? this.now
    const initial = args.resolve()
    if (!initial.outcome.ok) {
      if ('requestError' in initial.outcome) {
        return { ok: false, requestError: initial.outcome.requestError }
      }
      return { ok: false, failure: initial.outcome.failure }
    }
    const original = initial.outcome.launch
    const originalFingerprint = original.admissionGuard.fingerprint

    const prepFailure = await this.runPreparation(args, original)
    if (prepFailure) {
      return { ok: false, failure: prepFailure }
    }

    const result = await this.coordinator.runExclusive<CriticalResult>(() =>
      this.admitInsideCoordinator(args, original, originalFingerprint, nowFn)
    )
    if (result.kind === 'requestError') {
      return { ok: false, requestError: result.requestError }
    }
    if (result.kind === 'failure') {
      return { ok: false, failure: result.failure }
    }

    const token = result.record.launchToken
    // Plan is built from the ORIGINAL launch; the immutable admitted snapshot is
    // the one that spawns even if a later edit changed the live definition.
    const plan = buildAgentStartupPlanFromResolvedLaunch({
      launch: original,
      prompt: args.prompt,
      ...(args.allowEmptyPromptLaunch !== undefined
        ? { allowEmptyPromptLaunch: args.allowEmptyPromptLaunch }
        : {}),
      launchToken: token
    })
    if (!plan) {
      // Nothing launchable (empty prompt, empty launch disallowed): release the
      // reservation rather than stranding it.
      this.admissionStore.release(token)
      return {
        ok: false,
        failure: {
          code: 'no_agent_selected',
          requestedAgent: original.requestedAgent,
          baseAgent: original.baseAgent
        }
      }
    }

    return {
      ok: true,
      plan,
      receipt: {
        requestedAgent: original.requestedAgent,
        baseAgent: original.baseAgent,
        notices: dedupeNoticesByCode(original.notices),
        launchToken: token,
        catalogRevision: result.catalogRevision
      }
    }
  }

  /** Move or release the admission reservation once the caller's writer settled.
   *  Registered retains a private handoff record; failed releases entirely. */
  settleAgentLaunch(launchToken: string, settlement: LaunchSettlement): void {
    if (settlement === 'registered') {
      const record = this.admissionStore.get(launchToken)
      if (record) {
        this.retained.set(launchToken, record)
      }
    }
    this.admissionStore.release(launchToken)
  }

  /** Private reconciliation lookup; never returned to clients. */
  retainedFor(launchToken: string): AdmittedLaunchRecord | null {
    return this.retained.get(launchToken) ?? null
  }

  private async runPreparation(
    args: ExecuteAgentLaunchArgs,
    original: ResolvedAgentLaunch
  ): Promise<AgentLaunchFailure | null> {
    const preflightFailure = { code: 'trust_preflight_failed' as const, ...agentIds(original) }
    if (args.preflight) {
      try {
        await args.preflight(original)
      } catch {
        return preflightFailure
      }
    }
    if (args.prepareEnv) {
      try {
        await args.prepareEnv(original)
      } catch {
        return preflightFailure
      }
    }
    return null
  }

  private admitInsideCoordinator(
    args: ExecuteAgentLaunchArgs,
    original: ResolvedAgentLaunch,
    originalFingerprint: string,
    nowFn: () => number
  ): CriticalResult {
    // Re-take the atomic host view; no trust/fs/network/provider I/O runs here.
    const reResolution = args.resolve()
    if (!reResolution.outcome.ok) {
      if ('requestError' in reResolution.outcome) {
        return { kind: 'requestError', requestError: reResolution.outcome.requestError }
      }
      return { kind: 'failure', failure: mapAdmissionMismatch(reResolution.outcome.failure) }
    }
    if (reResolution.outcome.launch.admissionGuard.fingerprint !== originalFingerprint) {
      return {
        kind: 'failure',
        failure: { code: 'agent_configuration_changed', ...agentIds(original) }
      }
    }
    const admission = this.admissionStore.admit({
      principal: args.principal,
      intent: original.policy.intent,
      scope: args.scope,
      fingerprint: originalFingerprint,
      snapshot: original.snapshot,
      admittedAt: nowFn()
    })
    if (!admission.ok) {
      return { kind: 'failure', failure: admission.failure }
    }
    return {
      kind: 'admitted',
      record: admission.record,
      catalogRevision: reResolution.catalogRevision
    }
  }
}

function agentIds(launch: ResolvedAgentLaunch): {
  requestedAgent: ResolvedAgentLaunch['requestedAgent']
  baseAgent: ResolvedAgentLaunch['baseAgent']
} {
  return { requestedAgent: launch.requestedAgent, baseAgent: launch.baseAgent }
}
