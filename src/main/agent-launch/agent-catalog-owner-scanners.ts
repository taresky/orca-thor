// Built-in tombstone-reference owner scanners: each reports how many settings/
// repo/automation records still point at a given custom-agent id. A scan that
// throws returns { ok: false } so the tombstone is conservatively retained.

import type { Store } from '../persistence'
import type { GlobalSettings, TerminalQuickCommand } from '../../shared/types'
import {
  countReferencedCustomIds,
  type AgentTombstoneReferenceIndex
} from './agent-tombstone-reference-index'

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
}
