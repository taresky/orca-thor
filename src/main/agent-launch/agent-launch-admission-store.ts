// Host-private admitted-pending launch store and the admission coordinator.
// Admission is the launch linearization point (I24): inside one short critical
// section the host revalidates the relevant-input fingerprint and commits the
// token/snapshot/provider intent BEFORE any provider I/O. Records are bounded:
// 256 per host, 64 per authenticated principal, remote principals collectively
// capped so 64 slots stay reserved for local desktop/host work. Rejection is
// launch_capacity_exceeded before provider I/O and before any owner mutation.

import { randomBytes } from 'node:crypto'
import type { AgentLaunchSnapshot } from '../../shared/agent-launch-host-contract'
import type { AgentLaunchFailure } from '../../shared/agent-launch-contract'
import type { AgentLaunchIntentKind } from '../../shared/agent-launch-contract'

export const MAX_PENDING_LAUNCHES_PER_HOST = 256
export const MAX_PENDING_LAUNCHES_PER_PRINCIPAL = 64
export const MAX_PENDING_LAUNCHES_REMOTE_TOTAL = 192

/** Stable authenticated principal: device or runtime-host id for remote
 *  callers, the local desktop/host otherwise. Never a per-connection value. */
export type AdmissionPrincipal = { kind: 'local' } | { kind: 'remote'; id: string }

export type AdmittedLaunchRecord = {
  launchToken: string
  principal: AdmissionPrincipal
  intent: AgentLaunchIntentKind
  /** Owner scope for reconciliation joins (worktree id, pane key, run id …). */
  scope: string
  fingerprint: string
  snapshot: AgentLaunchSnapshot
  admittedAt: number
}

export type AdmissionResult =
  | { ok: true; record: AdmittedLaunchRecord }
  | { ok: false; failure: AgentLaunchFailure }

function principalKey(principal: AdmissionPrincipal): string {
  return principal.kind === 'local' ? 'local' : `remote:${principal.id}`
}

export class AgentLaunchAdmissionStore {
  private readonly byToken = new Map<string, AdmittedLaunchRecord>()
  private readonly countsByPrincipal = new Map<string, number>()
  private remoteTotal = 0

  /** Commit an admitted-pending record. Call ONLY from inside the coordinator's
   *  critical section, after the fingerprint recheck passed. */
  admit(input: {
    principal: AdmissionPrincipal
    intent: AgentLaunchIntentKind
    scope: string
    fingerprint: string
    snapshot: AgentLaunchSnapshot
    admittedAt: number
  }): AdmissionResult {
    const key = principalKey(input.principal)
    const principalCount = this.countsByPrincipal.get(key) ?? 0
    const isRemote = input.principal.kind === 'remote'
    if (
      this.byToken.size >= MAX_PENDING_LAUNCHES_PER_HOST ||
      principalCount >= MAX_PENDING_LAUNCHES_PER_PRINCIPAL ||
      // Remote principals collectively stop short of the host cap so local
      // desktop/host work always retains reserved capacity.
      (isRemote && this.remoteTotal >= MAX_PENDING_LAUNCHES_REMOTE_TOTAL)
    ) {
      return {
        ok: false,
        failure: { code: 'launch_capacity_exceeded', reason: 'capacity' }
      }
    }
    const record: AdmittedLaunchRecord = {
      launchToken: randomBytes(24).toString('base64url'),
      principal: input.principal,
      intent: input.intent,
      scope: input.scope,
      fingerprint: input.fingerprint,
      snapshot: input.snapshot,
      admittedAt: input.admittedAt
    }
    this.byToken.set(record.launchToken, record)
    this.countsByPrincipal.set(key, principalCount + 1)
    if (isRemote) {
      this.remoteTotal += 1
    }
    return { ok: true, record }
  }

  get(launchToken: string): AdmittedLaunchRecord | null {
    return this.byToken.get(launchToken) ?? null
  }

  /** Release on receipt (moved to terminal attribution), provider failure,
   *  admission mismatch, authoritative reconciliation, or explicit forget.
   *  Never by age while liveness is unknown. */
  release(launchToken: string): boolean {
    const record = this.byToken.get(launchToken)
    if (!record) {
      return false
    }
    this.byToken.delete(launchToken)
    const key = principalKey(record.principal)
    const count = this.countsByPrincipal.get(key) ?? 0
    if (count <= 1) {
      this.countsByPrincipal.delete(key)
    } else {
      this.countsByPrincipal.set(key, count - 1)
    }
    if (record.principal.kind === 'remote') {
      this.remoteTotal = Math.max(0, this.remoteTotal - 1)
    }
    return true
  }

  /** Rebuild counters from durable pending records once at startup; later
   *  transitions update counters incrementally rather than rescanning. */
  rebuildFrom(records: Iterable<AdmittedLaunchRecord>): void {
    this.byToken.clear()
    this.countsByPrincipal.clear()
    this.remoteTotal = 0
    for (const record of records) {
      this.byToken.set(record.launchToken, record)
      const key = principalKey(record.principal)
      this.countsByPrincipal.set(key, (this.countsByPrincipal.get(key) ?? 0) + 1)
      if (record.principal.kind === 'remote') {
        this.remoteTotal += 1
      }
    }
  }

  pendingCount(): number {
    return this.byToken.size
  }

  pendingForPrincipal(principal: AdmissionPrincipal): number {
    return this.countsByPrincipal.get(principalKey(principal)) ?? 0
  }

  /** Secret-free rows for the capacity-recovery surface: never snapshot, argv,
   *  env, prompt, label, or the token of another principal's row. */
  summarizeFor(principal: AdmissionPrincipal): {
    intent: AgentLaunchIntentKind
    scope: string
    admittedAt: number
    launchToken: string
  }[] {
    const key = principalKey(principal)
    const rows: {
      intent: AgentLaunchIntentKind
      scope: string
      admittedAt: number
      launchToken: string
    }[] = []
    for (const record of this.byToken.values()) {
      if (principalKey(record.principal) === key) {
        rows.push({
          intent: record.intent,
          scope: record.scope,
          admittedAt: record.admittedAt,
          launchToken: record.launchToken
        })
      }
    }
    return rows
  }
}

/** Short async critical section shared by launch admission and every mutation
 *  of admission-relevant inputs. No trust, filesystem, network, home lookup, or
 *  provider call may run while held — callers do I/O before/after, never inside. */
export class LaunchAdmissionCoordinator {
  private tail: Promise<void> = Promise.resolve()

  runExclusive<T>(critical: () => T): Promise<T> {
    const run = this.tail.then(() => critical())
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}
