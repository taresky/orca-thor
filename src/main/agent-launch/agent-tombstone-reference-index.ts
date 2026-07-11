// Authoritative reference index over every persisted owner of an agent
// reference. Tombstones are reference-counted recovery records: one is pruned
// only after an authoritative recheck proves zero references in every owner
// store, and an unavailable/corrupt owner store means "retain". Owners added by
// later feature units (worktree pending launches, background attempts,
// orchestration dispatches, sleeping sessions) register additional scanners
// here rather than growing a parallel index.

import type { CustomTuiAgentId } from '../../shared/types'
import type {
  AgentReferenceOwnerKind,
  AgentReferenceSummary
} from '../../shared/agent-reference-snapshot'
import { isCustomTuiAgentId } from '../../shared/custom-tui-agents'

export type { AgentReferenceSummary }

export type AgentReferenceScanResult =
  | { ok: true; referenceCounts: ReadonlyMap<CustomTuiAgentId, number> }
  | { ok: false }

export type AgentReferenceOwnerScanner = {
  owner: AgentReferenceOwnerKind
  /** Return every custom id this owner store currently references with its row
   *  count, or ok:false when the store cannot be read (conservative retain).
   *  Never throw. */
  scan: () => AgentReferenceScanResult
}

export function countReferencedCustomIds(values: Iterable<unknown>): Map<CustomTuiAgentId, number> {
  const counts = new Map<CustomTuiAgentId, number>()
  for (const value of values) {
    if (isCustomTuiAgentId(value)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return counts
}

export class AgentTombstoneReferenceIndex {
  private readonly scanners: AgentReferenceOwnerScanner[] = []

  register(scanner: AgentReferenceOwnerScanner): void {
    this.scanners.push(scanner)
  }

  /** Authoritative recheck across every registered owner. Returns 'unknown'
   *  when any owner scan fails, which callers must treat as "retain". */
  countReferences(id: CustomTuiAgentId): number | 'unknown' {
    let total = 0
    for (const scanner of this.scanners) {
      const result = scanner.scan()
      if (!result.ok) {
        return 'unknown'
      }
      total += result.referenceCounts.get(id) ?? 0
    }
    return total
  }

  /** Per-owner counts for delete confirmation and "Review references". Owners
   *  whose scan failed report count -1 so the UI can say "unknown". */
  summarizeReferences(id: CustomTuiAgentId): AgentReferenceSummary[] {
    const byOwner = new Map<AgentReferenceOwnerScanner['owner'], number>()
    for (const scanner of this.scanners) {
      const result = scanner.scan()
      if (!result.ok) {
        byOwner.set(scanner.owner, -1)
        continue
      }
      const count = result.referenceCounts.get(id) ?? 0
      const existing = byOwner.get(scanner.owner)
      if (existing === -1) {
        continue
      }
      byOwner.set(scanner.owner, (existing ?? 0) + count)
    }
    const summaries: AgentReferenceSummary[] = []
    for (const [owner, count] of byOwner) {
      if (count !== 0) {
        summaries.push({ owner, count })
      }
    }
    return summaries
  }
}
