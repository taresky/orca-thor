// Host-private admitted-pending launch store and the admission coordinator.
// Admission is the launch linearization point (I24): inside one short critical
// section the host revalidates the relevant-input fingerprint and commits the
// token/snapshot/provider intent BEFORE any provider I/O. Records are bounded:
// 256 per host, 64 per authenticated principal, remote principals collectively
// capped so 64 slots stay reserved for local desktop/host work. Rejection is
// launch_capacity_exceeded before provider I/O and before any owner mutation.

import { randomBytes } from 'node:crypto'
import type {
  AgentLaunchExecutionHostId,
  AgentLaunchSnapshot
} from '../../shared/agent-launch-host-contract'
import type { AgentLaunchFailure } from '../../shared/agent-launch-contract'
import type { AgentLaunchIntentKind } from '../../shared/agent-launch-contract'
import type { BuiltInTuiAgent } from '../../shared/types'

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

/** Redacted host-side capacity-recovery row for the pending-summary surface.
 *  Adds only the two non-secret snapshot fields the sheet needs (base harness,
 *  execution host id) to the summarize set; the launch token stays host-side for
 *  the liveness scan and is never projected to the client DTO. */
export type AdmissionCapacityRow = {
  intent: AgentLaunchIntentKind
  scope: string
  admittedAt: number
  launchToken: string
  baseHarness: BuiltInTuiAgent
  executionHostId: AgentLaunchExecutionHostId
}

/** Fields common to a fresh admit and a reserved admit. Principal comes from the
 *  request for admit and from the held reservation for admitReserved. */
export type AgentLaunchAdmitInput = {
  intent: AgentLaunchIntentKind
  scope: string
  fingerprint: string
  snapshot: AgentLaunchSnapshot
  admittedAt: number
}

/** A pre-spawn capacity hold taken before git/worktree mutation so a
 *  launch_capacity_exceeded rejection precedes any side effect. Converted into a
 *  committed record by admitReserved, or dropped by releaseReservation on any
 *  pre-spawn exit. Counts toward the caps while held. */
export type AdmissionReservation = { reservationId: string; principal: AdmissionPrincipal }

export type ReservationResult =
  | { ok: true; reservation: AdmissionReservation }
  | { ok: false; failure: AgentLaunchFailure }

export function principalKey(principal: AdmissionPrincipal): string {
  return principal.kind === 'local' ? 'local' : `remote:${principal.id}`
}

export class AgentLaunchAdmissionStore {
  private readonly byToken = new Map<string, AdmittedLaunchRecord>()
  private readonly countsByPrincipal = new Map<string, number>()
  private readonly reservations = new Map<string, AdmissionPrincipal>()
  private remoteTotal = 0

  /** launch_capacity_exceeded when any cap is at its bound, else null. Held
   *  reservations count toward every cap alongside committed records. */
  private capacityFailure(principal: AdmissionPrincipal): AgentLaunchFailure | null {
    const principalCount = this.countsByPrincipal.get(principalKey(principal)) ?? 0
    if (
      this.byToken.size + this.reservations.size >= MAX_PENDING_LAUNCHES_PER_HOST ||
      principalCount >= MAX_PENDING_LAUNCHES_PER_PRINCIPAL ||
      // Remote principals collectively stop short of the host cap so local
      // desktop/host work always retains reserved capacity.
      (principal.kind === 'remote' && this.remoteTotal >= MAX_PENDING_LAUNCHES_REMOTE_TOTAL)
    ) {
      return { code: 'launch_capacity_exceeded', reason: 'capacity' }
    }
    return null
  }

  private incrementCounters(principal: AdmissionPrincipal): void {
    const key = principalKey(principal)
    this.countsByPrincipal.set(key, (this.countsByPrincipal.get(key) ?? 0) + 1)
    if (principal.kind === 'remote') {
      this.remoteTotal += 1
    }
  }

  private decrementCounters(principal: AdmissionPrincipal): void {
    const key = principalKey(principal)
    const count = this.countsByPrincipal.get(key) ?? 0
    if (count <= 1) {
      this.countsByPrincipal.delete(key)
    } else {
      this.countsByPrincipal.set(key, count - 1)
    }
    if (principal.kind === 'remote') {
      this.remoteTotal = Math.max(0, this.remoteTotal - 1)
    }
  }

  /** Commit an admitted-pending record. Call ONLY from inside the coordinator's
   *  critical section, after the fingerprint recheck passed. */
  admit(input: AgentLaunchAdmitInput & { principal: AdmissionPrincipal }): AdmissionResult {
    const failure = this.capacityFailure(input.principal)
    if (failure) {
      return { ok: false, failure }
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
    this.incrementCounters(input.principal)
    return { ok: true, record }
  }

  /** Take a capacity hold before git/worktree mutation. The pre-create stage
   *  reserves so a full worktree is never created for an over-cap launch. */
  reserve(principal: AdmissionPrincipal): ReservationResult {
    const failure = this.capacityFailure(principal)
    if (failure) {
      return { ok: false, failure }
    }
    const reservationId = randomBytes(18).toString('base64url')
    this.reservations.set(reservationId, principal)
    this.incrementCounters(principal)
    return { ok: true, reservation: { reservationId, principal } }
  }

  /** Convert a held reservation into a committed record after the post-create
   *  fingerprint recheck. Counters already include the reservation, so this
   *  never re-increments. A lost/expired reservation fails closed. */
  admitReserved(reservationId: string, input: AgentLaunchAdmitInput): AdmissionResult {
    const principal = this.reservations.get(reservationId)
    if (!principal) {
      return { ok: false, failure: { code: 'launch_capacity_exceeded', reason: 'capacity' } }
    }
    this.reservations.delete(reservationId)
    const record: AdmittedLaunchRecord = {
      launchToken: randomBytes(24).toString('base64url'),
      principal,
      intent: input.intent,
      scope: input.scope,
      fingerprint: input.fingerprint,
      snapshot: input.snapshot,
      admittedAt: input.admittedAt
    }
    this.byToken.set(record.launchToken, record)
    return { ok: true, record }
  }

  /** Drop a reservation that never admitted (pre-spawn exit, mismatch, or a
   *  failed post-create resolution). Frees its held capacity. */
  releaseReservation(reservationId: string): boolean {
    const principal = this.reservations.get(reservationId)
    if (!principal) {
      return false
    }
    this.reservations.delete(reservationId)
    this.decrementCounters(principal)
    return true
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
    this.decrementCounters(record.principal)
    return true
  }

  /** Rebuild counters from durable pending records once at startup; later
   *  transitions update counters incrementally rather than rescanning.
   *  Reservations are ephemeral pre-spawn holds and never persist, so a rebuild
   *  starts with none. */
  rebuildFrom(records: Iterable<AdmittedLaunchRecord>): void {
    this.byToken.clear()
    this.countsByPrincipal.clear()
    this.reservations.clear()
    this.remoteTotal = 0
    for (const record of records) {
      this.byToken.set(record.launchToken, record)
      this.incrementCounters(record.principal)
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

  /** Redacted capacity-recovery rows for one principal: the summarize set plus the
   *  two non-secret snapshot fields the sheet needs. Filters strictly to the
   *  principal's own records; never another principal's row. */
  capacitySummaryFor(principal: AdmissionPrincipal): AdmissionCapacityRow[] {
    const key = principalKey(principal)
    const rows: AdmissionCapacityRow[] = []
    for (const record of this.byToken.values()) {
      if (principalKey(record.principal) === key) {
        rows.push({
          intent: record.intent,
          scope: record.scope,
          admittedAt: record.admittedAt,
          launchToken: record.launchToken,
          baseHarness: record.snapshot.baseAgent,
          executionHostId: record.snapshot.target.executionHostId
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
