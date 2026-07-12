// Built-in tombstone-reference owner scanners: each reports how many settings/
// repo/automation/session records still point at a given custom-agent id. A scan
// that throws returns { ok: false } so the tombstone is conservatively retained.

import type { Store } from '../persistence'
import type { GlobalSettings, TerminalQuickCommand } from '../../shared/types'
import {
  countReferencedCustomIds,
  type AgentTombstoneReferenceIndex
} from './agent-tombstone-reference-index'
import { getHostAgentSessionRecordStore } from './agent-session-record-store-host'

/** Register the desktop's built-in reference owners against the shared index.
 *  Later units add their own owner scanners through the same index. */
export function registerBuiltInOwnerScanners(
  index: AgentTombstoneReferenceIndex,
  store: Store
): void {
  const settings = (): GlobalSettings => store.getSettings()
  index.register({
    owner: 'default',
    scan: () => {
      try {
        return {
          ok: true,
          referenceCounts: countReferencedCustomIds([settings().defaultTuiAgent])
        }
      } catch {
        return { ok: false }
      }
    }
  })
  index.register({
    owner: 'quick-command',
    scan: () => {
      try {
        const commands: TerminalQuickCommand[] = settings().terminalQuickCommands ?? []
        return {
          ok: true,
          referenceCounts: countReferencedCustomIds(
            commands.map((command) => ('agent' in command ? command.agent : null))
          )
        }
      } catch {
        return { ok: false }
      }
    }
  })
  index.register({
    owner: 'commit-message',
    scan: () => {
      try {
        return {
          ok: true,
          referenceCounts: countReferencedCustomIds([
            settings().commitMessageAi?.agentId,
            settings().sourceControlAi?.agentId
          ])
        }
      } catch {
        return { ok: false }
      }
    }
  })
  index.register({
    owner: 'source-control-recipe',
    scan: () => {
      try {
        const references: unknown[] = []
        const actions = settings().sourceControlAi?.actions
        if (actions) {
          for (const action of Object.values(actions)) {
            if (action && typeof action === 'object' && 'agentId' in action) {
              references.push((action as { agentId?: unknown }).agentId)
            }
          }
        }
        // Repo-scoped Source Control overrides are persisted per repo.
        for (const repo of store.getRepos()) {
          const overrides = repo.sourceControlAi?.actionOverrides
          if (!overrides) {
            continue
          }
          for (const override of Object.values(overrides)) {
            if (override && typeof override === 'object' && 'agentId' in override) {
              references.push((override as { agentId?: unknown }).agentId)
            }
          }
        }
        return { ok: true, referenceCounts: countReferencedCustomIds(references) }
      } catch {
        return { ok: false }
      }
    }
  })
  index.register({
    owner: 'automation',
    scan: () => {
      try {
        const automations = store.listAutomations()
        return {
          ok: true,
          referenceCounts: countReferencedCustomIds(
            automations.map((automation) => automation.agentId)
          )
        }
      } catch {
        return { ok: false }
      }
    }
  })
  index.register({
    owner: 'workspace',
    scan: () => {
      try {
        // A two-stage creation records the pinned requested identity on both the
        // in-flight pending launch and the durable post-create failure, so a
        // tombstone stays retained until neither still points at the custom id.
        const references: unknown[] = []
        for (const meta of Object.values(store.getAllWorktreeMeta())) {
          references.push(meta.pendingAgentLaunch?.requestedAgent)
          references.push(meta.agentLaunchFailure?.requestedAgent)
        }
        return { ok: true, referenceCounts: countReferencedCustomIds(references) }
      } catch {
        return { ok: false }
      }
    }
  })
  index.register({
    // §266 `session` = AI Vault/workspace plus sleeping/resumable sessions. The
    // host-private record store is the resume authority: every bound resumable
    // session registers its requested identity there and the record survives pane
    // dispose, so it is the complete source of custom-id session references.
    // AI Vault sessions are disk-discovered and hold no persisted catalog id.
    owner: 'session',
    scan: () => {
      try {
        return {
          ok: true,
          referenceCounts: countReferencedCustomIds(
            getHostAgentSessionRecordStore().referencedRequestedAgents()
          )
        }
      } catch {
        return { ok: false }
      }
    }
  })
}
