import { describe, expect, it } from 'vitest'
import type { CustomTuiAgent, CustomTuiAgentId, GlobalSettings } from '../../shared/types'
import {
  buildAgentCatalogSnapshot,
  buildLocalAgentCatalogSnapshot,
  measureLocalAgentCatalogStorage,
  projectLegacyDefaultTuiAgent,
  projectLegacyDisabledTuiAgents
} from './agent-catalog-projections'
import { AgentCatalogRepairTokenRegistry } from './agent-catalog-mutations'

const UUID_A = '01234567-89ab-4cde-8f01-23456789abcd'
const UUID_B = 'fedcba98-7654-4321-8fed-cba987654321'

function customId(base: string, uuid = UUID_A): CustomTuiAgentId {
  return `custom-agent:${base}:${uuid}` as CustomTuiAgentId
}

function liveAgent(overrides: Partial<CustomTuiAgent> = {}): CustomTuiAgent {
  return {
    id: customId('codex'),
    baseAgent: 'codex',
    label: 'My Codex',
    args: '',
    env: {},
    syncEnv: false,
    ...overrides
  }
}

function settingsWith(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    defaultTuiAgent: 'auto',
    disabledTuiAgents: [],
    customTuiAgents: [],
    deletedCustomTuiAgents: [],
    agentCatalogRevision: 2,
    ...overrides
  } as GlobalSettings
}

describe('remote snapshot projection', () => {
  it('projects ready rows env-free with the conservative availability hint', () => {
    const withheld = liveAgent({ env: { KEY: 'secret-value' }, syncEnv: false })
    const available = liveAgent({
      id: customId('claude', UUID_B),
      baseAgent: 'claude',
      label: 'Shared',
      env: { TOKEN: 'another-secret' },
      syncEnv: true
    })
    const snapshot = buildAgentCatalogSnapshot(
      settingsWith({ customTuiAgents: [withheld, available] })
    )
    expect('code' in snapshot).toBe(false)
    if ('code' in snapshot) {
      return
    }
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain('secret-value')
    expect(text).not.toContain('another-secret')
    expect(text).not.toContain('KEY')
    expect(text).not.toContain('TOKEN')
    const [first, second] = snapshot.customAgents
    expect(first).toMatchObject({
      status: 'ready',
      envState: 'withheld',
      availabilityCheck: 'baseline-detection'
    })
    expect(second).toMatchObject({
      status: 'ready',
      envState: 'available',
      availabilityCheck: 'host-preflight'
    })
  })

  it('uses host-preflight for a configured executable regardless of env', () => {
    const snapshot = buildAgentCatalogSnapshot(
      settingsWith({ customTuiAgents: [liveAgent({ commandOverride: '/opt/codex' })] })
    )
    if ('code' in snapshot) {
      throw new Error('unexpected projection error')
    }
    expect(snapshot.customAgents[0]).toMatchObject({ availabilityCheck: 'host-preflight' })
  })

  it('projects valid-id repair rows without raw fields and omits malformed/duplicate rows', () => {
    const repairRow = { ...liveAgent(), label: '', args: '"unclosed' }
    const malformed = { id: 'custom-agent:codex:nope', baseAgent: 'codex', label: 'Bad' }
    const duplicateId = customId('claude', UUID_B)
    const dupA = liveAgent({ id: duplicateId, baseAgent: 'claude', label: 'Dup A' })
    const dupB = liveAgent({ id: duplicateId, baseAgent: 'claude', label: 'Dup B' })
    const snapshot = buildAgentCatalogSnapshot(
      settingsWith({
        customTuiAgents: [repairRow, malformed as unknown as CustomTuiAgent, dupA, dupB]
      })
    )
    if ('code' in snapshot) {
      throw new Error('unexpected projection error')
    }
    expect(snapshot.customAgents).toHaveLength(1)
    expect(snapshot.customAgents[0]).toMatchObject({
      id: repairRow.id,
      status: 'repair-required',
      label: null,
      envState: 'none'
    })
    expect(JSON.stringify(snapshot)).not.toContain('unclosed')
  })

  it('returns the typed projection error above 512 KiB while keeping version and revision', () => {
    // ~200 agents x ~4 KiB args ≈ >512 KiB serialized (args are projected).
    const agents: CustomTuiAgent[] = []
    for (let i = 0; i < 200; i += 1) {
      agents.push(
        liveAgent({
          id: `custom-agent:codex:${UUID_A.slice(0, 34)}${String(i % 100).padStart(2, '0')}` as CustomTuiAgentId,
          label: `Agent ${i}`,
          args: `--marker ${'x'.repeat(4000)}`
        })
      )
    }
    // Ensure unique canonical ids (vary last two hex chars).
    const unique = agents.map((agent, index) => ({
      ...agent,
      id: `custom-agent:codex:${UUID_A.slice(0, -4)}${index.toString(16).padStart(4, '0')}` as CustomTuiAgentId
    }))
    const snapshot = buildAgentCatalogSnapshot(settingsWith({ customTuiAgents: unique }))
    expect(snapshot).toMatchObject({
      version: 1,
      revision: 2,
      code: 'agent_catalog_payload_too_large',
      maxBytes: 524_288
    })
  })

  it('replaces an invalid tombstone label with an empty string for remote fallback copy', () => {
    const snapshot = buildAgentCatalogSnapshot(
      settingsWith({
        deletedCustomTuiAgents: [
          { id: customId('codex'), baseAgent: 'codex', label: '   ', deletedAt: 1 }
        ]
      })
    )
    if ('code' in snapshot) {
      throw new Error('unexpected projection error')
    }
    expect(snapshot.deletedCustomAgents[0].label).toBe('')
  })
})

describe('local snapshot projection', () => {
  it('summarizes env numerically, mints repair tokens, and reports both budgets', () => {
    const live = liveAgent({ env: { KEY: 'secret-value' } })
    const malformed = { id: 'custom-agent:codex:nope', label: 'Bad' }
    const registry = new AgentCatalogRepairTokenRegistry()
    const snapshot = buildLocalAgentCatalogSnapshot(
      settingsWith({ customTuiAgents: [live, malformed as unknown as CustomTuiAgent] }),
      registry
    )
    expect(JSON.stringify(snapshot)).not.toContain('secret-value')
    const ready = snapshot.customAgents.find((row) => row.status === 'ready')
    expect(ready && ready.status === 'ready' ? ready.envSummary.entryCount : -1).toBe(1)
    const repair = snapshot.customAgents.find((row) => row.status === 'repair-required')
    expect(
      repair && repair.status === 'repair-required' ? repair.repairToken.length : 0
    ).toBeGreaterThan(0)
    expect(snapshot.projection.status).toBe('ready')
    expect(snapshot.localStorage.status).toBe('ready')
  })

  it('keeps repair tokens stable across unrelated revisions', () => {
    const malformed = { id: 'custom-agent:codex:nope', label: 'Bad' }
    const registry = new AgentCatalogRepairTokenRegistry()
    const first = buildLocalAgentCatalogSnapshot(
      settingsWith({ customTuiAgents: [malformed as unknown as CustomTuiAgent] }),
      registry
    )
    const second = buildLocalAgentCatalogSnapshot(
      settingsWith({
        customTuiAgents: [malformed as unknown as CustomTuiAgent],
        agentCatalogRevision: 3
      }),
      registry
    )
    const tokenOf = (snapshot: typeof first): string => {
      const row = snapshot.customAgents[0]
      return row.status === 'repair-required' ? row.repairToken : ''
    }
    expect(tokenOf(first)).toBe(tokenOf(second))
  })

  it('measures the 16 MiB local storage budget over the full env-bearing catalog', () => {
    const status = measureLocalAgentCatalogStorage(settingsWith({ customTuiAgents: [liveAgent()] }))
    expect(status.status).toBe('ready')
    expect(status.maxBytes).toBe(16_777_216)
  })
})

describe('legacy client projections', () => {
  it('maps defaults so old clients never see custom ids or non-Auto null', () => {
    expect(projectLegacyDefaultTuiAgent('codex')).toBe('codex')
    expect(projectLegacyDefaultTuiAgent('auto')).toBeNull()
    expect(projectLegacyDefaultTuiAgent('blank')).toBe('blank')
    expect(projectLegacyDefaultTuiAgent(null)).toBe('blank')
    expect(projectLegacyDefaultTuiAgent(customId('codex'))).toBe('blank')
  })

  it('drops custom ids from the legacy disabled list', () => {
    expect(projectLegacyDisabledTuiAgents(['codex', customId('claude', UUID_B)])).toEqual(['codex'])
  })
})
