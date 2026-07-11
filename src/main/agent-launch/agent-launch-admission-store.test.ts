import { describe, expect, it } from 'vitest'
import type { AgentLaunchSnapshot } from '../../shared/agent-launch-host-contract'
import {
  AgentLaunchAdmissionStore,
  LaunchAdmissionCoordinator,
  MAX_PENDING_LAUNCHES_PER_HOST,
  MAX_PENDING_LAUNCHES_PER_PRINCIPAL,
  MAX_PENDING_LAUNCHES_REMOTE_TOTAL,
  type AdmissionPrincipal
} from './agent-launch-admission-store'

const SNAPSHOT: AgentLaunchSnapshot = Object.freeze({
  version: 1,
  requestedAgent: 'codex',
  baseAgent: 'codex',
  displayLabel: 'Codex',
  mode: 'built-in',
  argv: ['codex'],
  agentEnv: {},
  target: {
    platform: 'linux',
    execution: 'native',
    shell: 'posix',
    isRemote: false,
    executionHostId: 'local'
  }
} as const) as unknown as AgentLaunchSnapshot

function admitOne(store: AgentLaunchAdmissionStore, principal: AdmissionPrincipal, scope = 'wt-1') {
  return store.admit({
    principal,
    intent: 'interactive',
    scope,
    fingerprint: 'fp',
    snapshot: SNAPSHOT,
    admittedAt: 1
  })
}

describe('AgentLaunchAdmissionStore capacity', () => {
  it('caps each principal at 64 pending records', () => {
    const store = new AgentLaunchAdmissionStore()
    const principal: AdmissionPrincipal = { kind: 'remote', id: 'device-1' }
    for (let i = 0; i < MAX_PENDING_LAUNCHES_PER_PRINCIPAL; i += 1) {
      expect(admitOne(store, principal).ok).toBe(true)
    }
    const rejected = admitOne(store, principal)
    expect(rejected).toMatchObject({
      ok: false,
      failure: { code: 'launch_capacity_exceeded', reason: 'capacity' }
    })
    // A different principal still has capacity.
    expect(admitOne(store, { kind: 'remote', id: 'device-2' }).ok).toBe(true)
  })

  it('stops remote principals collectively at 192, reserving 64 local slots', () => {
    const store = new AgentLaunchAdmissionStore()
    for (let device = 0; device < 3; device += 1) {
      for (let i = 0; i < MAX_PENDING_LAUNCHES_PER_PRINCIPAL; i += 1) {
        expect(admitOne(store, { kind: 'remote', id: `device-${device}` }).ok).toBe(true)
      }
    }
    expect(store.pendingCount()).toBe(MAX_PENDING_LAUNCHES_REMOTE_TOTAL)
    expect(admitOne(store, { kind: 'remote', id: 'device-4' }).ok).toBe(false)
    // The local host retains its reserved capacity up to the host cap.
    let localAdmitted = 0
    while (admitOne(store, { kind: 'local' }).ok) {
      localAdmitted += 1
    }
    expect(localAdmitted).toBe(MAX_PENDING_LAUNCHES_PER_HOST - MAX_PENDING_LAUNCHES_REMOTE_TOTAL)
    expect(store.pendingCount()).toBe(MAX_PENDING_LAUNCHES_PER_HOST)
  })

  it('release frees exactly one reservation and unknown tokens are no-ops', () => {
    const store = new AgentLaunchAdmissionStore()
    const admitted = admitOne(store, { kind: 'local' })
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) {
      return
    }
    expect(store.release(admitted.record.launchToken)).toBe(true)
    expect(store.release(admitted.record.launchToken)).toBe(false)
    expect(store.pendingCount()).toBe(0)
    expect(store.pendingForPrincipal({ kind: 'local' })).toBe(0)
  })

  it('rebuilds counters once from durable records', () => {
    const store = new AgentLaunchAdmissionStore()
    const first = admitOne(store, { kind: 'remote', id: 'device-1' })
    const second = admitOne(store, { kind: 'local' })
    if (!first.ok || !second.ok) {
      throw new Error('fixture admit failed')
    }
    const rebuilt = new AgentLaunchAdmissionStore()
    rebuilt.rebuildFrom([first.record, second.record])
    expect(rebuilt.pendingCount()).toBe(2)
    expect(rebuilt.pendingForPrincipal({ kind: 'remote', id: 'device-1' })).toBe(1)
    expect(rebuilt.pendingForPrincipal({ kind: 'local' })).toBe(1)
  })

  it('summaries stay secret-free and principal-scoped', () => {
    const store = new AgentLaunchAdmissionStore()
    const mine = admitOne(store, { kind: 'remote', id: 'device-1' }, 'wt-42')
    admitOne(store, { kind: 'remote', id: 'device-2' }, 'wt-secret')
    expect(mine.ok).toBe(true)
    const rows = store.summarizeFor({ kind: 'remote', id: 'device-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ intent: 'interactive', scope: 'wt-42' })
    const text = JSON.stringify(rows)
    expect(text).not.toContain('argv')
    expect(text).not.toContain('agentEnv')
    expect(text).not.toContain('wt-secret')
  })

  it('capacity rows add base harness + host id, stay principal-scoped and secret-free', () => {
    const store = new AgentLaunchAdmissionStore()
    const mine = admitOne(store, { kind: 'remote', id: 'device-1' }, 'wt-42')
    admitOne(store, { kind: 'remote', id: 'device-2' }, 'wt-secret')
    expect(mine.ok).toBe(true)
    const rows = store.capacitySummaryFor({ kind: 'remote', id: 'device-1' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      intent: 'interactive',
      scope: 'wt-42',
      baseHarness: 'codex',
      executionHostId: 'local'
    })
    const text = JSON.stringify(rows)
    // Snapshot secrets never enter the row; only baseAgent + executionHostId do.
    expect(text).not.toContain('argv')
    expect(text).not.toContain('agentEnv')
    expect(text).not.toContain('displayLabel')
    expect(text).not.toContain('wt-secret')
  })
})

describe('AgentLaunchAdmissionStore reservations', () => {
  function reserveOne(store: AgentLaunchAdmissionStore, principal: AdmissionPrincipal) {
    return store.reserve(principal)
  }

  function admitReservedOne(
    store: AgentLaunchAdmissionStore,
    reservationId: string,
    scope = 'wt-1'
  ) {
    return store.admitReserved(reservationId, {
      intent: 'interactive',
      scope,
      fingerprint: 'fp',
      snapshot: SNAPSHOT,
      admittedAt: 1
    })
  }

  it('reserve holds capacity, and admitReserved converts without double-counting', () => {
    const store = new AgentLaunchAdmissionStore()
    const reservation = reserveOne(store, { kind: 'local' })
    expect(reservation.ok).toBe(true)
    if (!reservation.ok) {
      return
    }
    // The hold counts toward the principal cap before any commit.
    expect(store.pendingForPrincipal({ kind: 'local' })).toBe(1)
    // pendingCount tracks committed records only; the hold is not committed yet.
    expect(store.pendingCount()).toBe(0)
    const admitted = admitReservedOne(store, reservation.reservation.reservationId)
    expect(admitted.ok).toBe(true)
    // Converting a hold does not re-increment: still exactly one for the principal.
    expect(store.pendingForPrincipal({ kind: 'local' })).toBe(1)
    expect(store.pendingCount()).toBe(1)
  })

  it('held reservations count toward the per-principal cap', () => {
    const store = new AgentLaunchAdmissionStore()
    const principal: AdmissionPrincipal = { kind: 'remote', id: 'device-1' }
    for (let i = 0; i < MAX_PENDING_LAUNCHES_PER_PRINCIPAL; i += 1) {
      expect(reserveOne(store, principal).ok).toBe(true)
    }
    // Both a further reserve and a direct admit are rejected once the holds fill.
    expect(reserveOne(store, principal).ok).toBe(false)
    expect(admitOne(store, principal).ok).toBe(false)
  })

  it('held reservations count toward the collective remote cap', () => {
    const store = new AgentLaunchAdmissionStore()
    for (let device = 0; device < 3; device += 1) {
      for (let i = 0; i < MAX_PENDING_LAUNCHES_PER_PRINCIPAL; i += 1) {
        expect(reserveOne(store, { kind: 'remote', id: `device-${device}` }).ok).toBe(true)
      }
    }
    expect(reserveOne(store, { kind: 'remote', id: 'device-4' }).ok).toBe(false)
    // Local capacity is still reserved even while remote holds are maxed.
    expect(reserveOne(store, { kind: 'local' }).ok).toBe(true)
  })

  it('releaseReservation frees the held slot and unknown ids are no-ops', () => {
    const store = new AgentLaunchAdmissionStore()
    const reservation = reserveOne(store, { kind: 'local' })
    expect(reservation.ok).toBe(true)
    if (!reservation.ok) {
      return
    }
    expect(store.releaseReservation(reservation.reservation.reservationId)).toBe(true)
    expect(store.releaseReservation(reservation.reservation.reservationId)).toBe(false)
    expect(store.pendingForPrincipal({ kind: 'local' })).toBe(0)
  })

  it('admitReserved fails closed for a released or unknown reservation', () => {
    const store = new AgentLaunchAdmissionStore()
    const reservation = reserveOne(store, { kind: 'local' })
    expect(reservation.ok).toBe(true)
    if (!reservation.ok) {
      return
    }
    store.releaseReservation(reservation.reservation.reservationId)
    const admitted = admitReservedOne(store, reservation.reservation.reservationId)
    expect(admitted).toMatchObject({
      ok: false,
      failure: { code: 'launch_capacity_exceeded', reason: 'capacity' }
    })
    expect(admitReservedOne(store, 'never-issued').ok).toBe(false)
  })
})

describe('LaunchAdmissionCoordinator', () => {
  it('serializes critical sections in FIFO order and survives a throwing section', async () => {
    const coordinator = new LaunchAdmissionCoordinator()
    const order: number[] = []
    const first = coordinator.runExclusive(() => {
      order.push(1)
      return 'a'
    })
    const failing = coordinator.runExclusive(() => {
      order.push(2)
      throw new Error('boom')
    })
    const third = coordinator.runExclusive(() => {
      order.push(3)
      return 'c'
    })
    await expect(first).resolves.toBe('a')
    await expect(failing).rejects.toThrow('boom')
    await expect(third).resolves.toBe('c')
    expect(order).toEqual([1, 2, 3])
  })
})
