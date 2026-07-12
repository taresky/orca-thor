import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CustomTuiAgent,
  CustomTuiAgentId,
  GlobalSettings,
  Repo,
  TerminalAgentQuickCommand,
  TuiAgent,
  WorktreeMeta
} from '../../shared/types'
import type { Automation } from '../../shared/automations-types'
import type { Store } from '../persistence'
import { AgentCatalogService } from './agent-catalog-service'
import { getHostAgentSessionRecordStore } from './agent-session-record-store-host'
import type { HostSessionLaunchRecord } from './agent-session-record-store'

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

type StoreStubState = {
  settings: GlobalSettings
  repos: Repo[]
  automations: Automation[]
  worktreeMeta?: Record<string, WorktreeMeta>
  failAutomationScan?: boolean
  failWorktreeScan?: boolean
}

function makeStoreStub(state: StoreStubState): Store {
  const stub = {
    getSettings: () => state.settings,
    updateSettings: (updates: Partial<GlobalSettings>) => {
      state.settings = { ...state.settings, ...updates }
      return state.settings
    },
    getRepos: () => state.repos,
    listAutomations: () => {
      if (state.failAutomationScan) {
        throw new Error('store unavailable')
      }
      return state.automations
    },
    getAllWorktreeMeta: () => {
      if (state.failWorktreeScan) {
        throw new Error('store unavailable')
      }
      return state.worktreeMeta ?? {}
    }
  }
  return stub as unknown as Store
}

function baseSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    defaultTuiAgent: 'auto',
    disabledTuiAgents: [],
    customTuiAgents: [],
    deletedCustomTuiAgents: [],
    agentCatalogRevision: 1,
    agentReferenceRevision: 1,
    terminalQuickCommands: [],
    agentCmdOverrides: {},
    ...overrides
  } as GlobalSettings
}

function tombstoneFor(id: CustomTuiAgentId) {
  return { id, baseAgent: 'codex' as const, label: 'Gone', deletedAt: 1 }
}

function agentQuickCommand(agent: CustomTuiAgentId): TerminalAgentQuickCommand {
  return { id: 'qc-1', label: 'Q', action: 'agent-prompt', agent, prompt: 'p' }
}

describe('tombstone reference GC across owners', () => {
  const deadId = customId('codex', UUID_B)

  function serviceWith(state: Partial<StoreStubState>): {
    service: AgentCatalogService
    state: StoreStubState
  } {
    const fullState: StoreStubState = {
      settings: baseSettings(),
      repos: [],
      automations: [],
      ...state
    }
    return { service: new AgentCatalogService(makeStoreStub(fullState)), state: fullState }
  }

  it('retains the tombstone while the default references it and prunes after the last reference clears', () => {
    const { service, state } = serviceWith({
      settings: baseSettings({
        defaultTuiAgent: deadId,
        deletedCustomTuiAgents: [tombstoneFor(deadId)]
      })
    })
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(1)

    // Create with prune: tombstone retained because the default still points at it.
    const created = service.mutate({
      expectedRevision: 1,
      mutation: {
        kind: 'create',
        baseAgent: 'claude',
        draft: { label: 'Other', commandOverride: null, args: '', env: {}, syncEnv: false }
      }
    })
    expect(created.ok).toBe(true)
    expect(state.settings.deletedCustomTuiAgents).toHaveLength(1)

    // Clear the default (last reference), then the next prune removes it.
    const cleared = service.mutate({
      expectedRevision: state.settings.agentCatalogRevision ?? 1,
      mutation: { kind: 'set-default', agent: 'auto' }
    })
    expect(cleared.ok).toBe(true)
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(0)
    const created2 = service.mutate({
      expectedRevision: state.settings.agentCatalogRevision ?? 1,
      mutation: {
        kind: 'create',
        baseAgent: 'gemini',
        draft: { label: 'Another', commandOverride: null, args: '', env: {}, syncEnv: false }
      }
    })
    expect(created2.ok).toBe(true)
    expect(state.settings.deletedCustomTuiAgents).toHaveLength(0)
  })

  it('counts quick-command, commit-message, source-control (global and repo), and automation references', () => {
    const { service } = serviceWith({
      settings: baseSettings({
        terminalQuickCommands: [agentQuickCommand(deadId)],
        commitMessageAi: {
          enabled: true,
          agentId: deadId,
          selectedModelByAgent: {},
          selectedThinkingByModel: {},
          customPrompt: '',
          customAgentCommand: ''
        },
        sourceControlAi: {
          enabled: true,
          agentId: deadId,
          actions: { 'commit-message': { agentId: deadId, commandInputTemplate: '' } },
          selectedModelByAgent: {},
          selectedThinkingByModel: {},
          customAgentCommand: '',
          instructionsByOperation: {}
        } as GlobalSettings['sourceControlAi'],
        deletedCustomTuiAgents: [tombstoneFor(deadId)]
      }),
      repos: [
        {
          id: 'repo-1',
          sourceControlAi: {
            actionOverrides: { 'pr-review': { agentId: deadId, commandInputTemplate: '' } }
          }
        } as unknown as Repo
      ],
      automations: [{ id: 'auto-1', agentId: deadId } as unknown as Automation]
    })
    // quick-command 1 + commit-message agentId 1 + sourceControlAi agentId 1 +
    // action recipe 1 + repo override 1 + automation 1 = 6
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(6)
    const summary = service.getReferenceSummaries(deadId)
    expect(summary).toContainEqual({ owner: 'quick-command', count: 1 })
    expect(summary).toContainEqual({ owner: 'commit-message', count: 2 })
    expect(summary).toContainEqual({ owner: 'source-control-recipe', count: 2 })
    expect(summary).toContainEqual({ owner: 'automation', count: 1 })
  })

  it('counts workspace pending-launch and durable-failure references and prunes after the last clears', () => {
    const { service, state } = serviceWith({
      settings: baseSettings({ deletedCustomTuiAgents: [tombstoneFor(deadId)] }),
      worktreeMeta: {
        'wt-1': {
          pendingAgentLaunch: { operationId: 'op-1', requestedAgent: deadId }
        } as unknown as WorktreeMeta,
        'wt-2': {
          agentLaunchFailure: {
            version: 1,
            code: 'spawn_failed',
            requestedAgent: deadId,
            failureId: 'f-1',
            intent: 'interactive',
            occurredAt: 1
          }
        } as unknown as WorktreeMeta
      }
    })
    // pendingAgentLaunch.requestedAgent + agentLaunchFailure.requestedAgent = 2.
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(2)
    expect(service.getReferenceSummaries(deadId)).toContainEqual({ owner: 'workspace', count: 2 })

    // Last reference cleared -> the tombstone can prune.
    state.worktreeMeta = {}
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(0)
  })

  it('retains the tombstone when the workspace store is unavailable', () => {
    const { service } = serviceWith({
      settings: baseSettings({ deletedCustomTuiAgents: [tombstoneFor(deadId)] }),
      failWorktreeScan: true
    })
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe('unknown')
  })

  it('treats an unavailable owner store as unknown and retains the tombstone', () => {
    const { service, state } = serviceWith({
      settings: baseSettings({
        deletedCustomTuiAgents: [tombstoneFor(deadId)]
      }),
      failAutomationScan: true
    })
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe('unknown')
    const created = service.mutate({
      expectedRevision: 1,
      mutation: {
        kind: 'create',
        baseAgent: 'claude',
        draft: { label: 'New One', commandOverride: null, args: '', env: {}, syncEnv: false }
      }
    })
    expect(created.ok).toBe(true)
    expect(state.settings.deletedCustomTuiAgents).toHaveLength(1)
  })

  it('reference removal prunes the tombstone and advances both revisions', () => {
    const { service, state } = serviceWith({
      settings: baseSettings({
        terminalQuickCommands: [agentQuickCommand(deadId)],
        deletedCustomTuiAgents: [tombstoneFor(deadId)]
      })
    })
    const result = service.mutateReferences({
      expectedReferenceRevision: 1,
      mutation: { kind: 'quick-command-delete', id: 'qc-1' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.referenceRevision).toBe(2)
    // Tombstone pruned in the follow-up catalog write with its own revision bump.
    expect(state.settings.deletedCustomTuiAgents).toHaveLength(0)
    expect(state.settings.agentCatalogRevision).toBe(2)
    expect(result.catalogRevision).toBe(2)
  })
})

describe('session owner (host-private resume records)', () => {
  const recordStore = getHostAgentSessionRecordStore()
  const deadId = customId('codex', UUID_B)

  afterEach(() => {
    // The record store is a host-wide singleton; clear seeded records between tests.
    recordStore.rebuildRecordsFrom([])
    vi.restoreAllMocks()
  })

  function sessionRecord(requestedAgent: TuiAgent): HostSessionLaunchRecord {
    return {
      worktreeId: 'wt-session',
      requestedAgent,
      baseAgent: 'codex',
      providerSession: { key: 'session_id', id: 'sess-1' },
      registeredAt: 1,
      updatedAt: 1
    }
  }

  function serviceWithTombstone(): AgentCatalogService {
    const state: StoreStubState = {
      settings: baseSettings({ deletedCustomTuiAgents: [tombstoneFor(deadId)] }),
      repos: [],
      automations: []
    }
    return new AgentCatalogService(makeStoreStub(state))
  }

  it('retains the tombstone while a resumable session references the custom id and prunes after it is forgotten', () => {
    const service = serviceWithTombstone()

    recordStore.rebuildRecordsFrom([sessionRecord(deadId)])
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(1)
    expect(service.getReferenceSummaries(deadId)).toContainEqual({ owner: 'session', count: 1 })

    // Forgetting the last referencing session clears the reference so it can prune.
    recordStore.rebuildRecordsFrom([])
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe(0)
  })

  it('retains the tombstone when the session record store cannot be read', () => {
    const service = serviceWithTombstone()
    vi.spyOn(recordStore, 'referencedRequestedAgents').mockImplementation(() => {
      throw new Error('store unavailable')
    })
    expect(service.tombstoneReferenceIndex.countReferences(deadId)).toBe('unknown')
  })
})

describe('delete -> tombstone -> reference lifecycle', () => {
  it('keeps the tombstone alive through delete while a quick command references it', () => {
    const live = liveAgent()
    const state: StoreStubState = {
      settings: baseSettings({
        customTuiAgents: [live],
        terminalQuickCommands: [agentQuickCommand(live.id)]
      }),
      repos: [],
      automations: []
    }
    const service = new AgentCatalogService(makeStoreStub(state))
    const deleted = service.mutate({
      expectedRevision: 1,
      mutation: { kind: 'delete-custom', id: live.id }
    })
    expect(deleted.ok).toBe(true)
    expect(state.settings.customTuiAgents).toHaveLength(0)
    expect(state.settings.deletedCustomTuiAgents?.[0]?.id).toBe(live.id)
    expect(service.tombstoneReferenceIndex.countReferences(live.id)).toBe(1)
    // The label stays reserved while referenced.
    const relabel = service.mutate({
      expectedRevision: state.settings.agentCatalogRevision ?? 1,
      mutation: {
        kind: 'create',
        baseAgent: 'codex',
        draft: { label: 'My Codex', commandOverride: null, args: '', env: {}, syncEnv: false }
      }
    })
    expect(relabel).toMatchObject({ ok: false, code: 'duplicate_agent_label' })
  })
})

describe('local draft endpoint', () => {
  it('returns exactly one row at the current revision and rejects stale locators', () => {
    const live = liveAgent({ env: { SECRET: 'value' } })
    const state: StoreStubState = {
      settings: baseSettings({ customTuiAgents: [live], agentCatalogRevision: 7 }),
      repos: [],
      automations: []
    }
    const service = new AgentCatalogService(makeStoreStub(state))
    const draft = service.getLocalDraft({ id: live.id }, 7)
    expect(draft).toMatchObject({
      status: 'ready',
      revision: 7,
      draft: { label: 'My Codex', env: { SECRET: 'value' } }
    })
    expect(service.getLocalDraft({ id: live.id }, 6)).toEqual({ status: 'stale' })
    expect(service.getLocalDraft({ id: customId('claude', UUID_B) }, 7)).toEqual({
      status: 'stale'
    })
  })

  it('never returns env values in the list snapshot while the draft carries them', () => {
    const live = liveAgent({ env: { SECRET: 'value' } })
    const state: StoreStubState = {
      settings: baseSettings({ customTuiAgents: [live] }),
      repos: [],
      automations: []
    }
    const service = new AgentCatalogService(makeStoreStub(state))
    const snapshotText = JSON.stringify(service.getLocalSnapshot())
    expect(snapshotText).not.toContain('SECRET')
    expect(snapshotText).not.toContain('value')
    const remoteText = JSON.stringify(service.getRemoteSnapshot())
    expect(remoteText).not.toContain('SECRET')
    expect(remoteText).not.toContain('value')
    // Env presence is summarized numerically only.
    const local = service.getLocalSnapshot()
    const row = local.customAgents[0]
    expect(row.status).toBe('ready')
    if (row.status === 'ready') {
      expect(row.envSummary.entryCount).toBe(1)
    }
  })
})
