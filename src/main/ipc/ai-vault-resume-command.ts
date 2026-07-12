// Desktop host surface for AI Vault resume (U5): re-validate a client-echoed
// entry against the desktop's OWN fresh multi-host discovery, then either return
// the discovered session for a spawn (pty.ts) or assemble the copyable command
// string. Split out of ai-vault.ts so the scan orchestration and the resume
// surface stay independently sized. The discovery function is injected so this
// module never imports the scan orchestration (no cycle).

import { ipcMain } from 'electron'
import {
  findVaultResumeSession,
  resolveVaultResumeCopyCommand,
  type VaultResumeAssemblySettings,
  type VaultResumeCopyResult,
  type VaultResumeSession
} from '../agent-launch/agent-launch-vault-resume'
import type { AgentLaunchVaultResumeEntry } from '../../shared/agent-launch-spawn-request'
import type { AiVaultListArgs, AiVaultListResult } from '../../shared/ai-vault-types'

// Why: force a fresh scan scoped to the entry's host so a deleted session cannot
// replay from stale cache; the high limit surfaces an older target past the
// default recency cap. Resume/copy are user-initiated, not a hot path.
const VAULT_RESUME_REVALIDATION_LIMIT = 2000

export type DiscoverAiVaultSessions = (args: AiVaultListArgs) => Promise<AiVaultListResult>

async function discoverForEntry(
  entry: AgentLaunchVaultResumeEntry,
  discover: DiscoverAiVaultSessions
): Promise<AiVaultListResult> {
  return discover({
    executionHostScope: entry.executionHostId,
    limit: VAULT_RESUME_REVALIDATION_LIMIT,
    force: true
  })
}

// Re-validate a client-echoed entry against the desktop's OWN discovery, scoped
// to the entry's host (local/ssh/runtime) so it matches what the picker showed.
// Returns the host-discovered session (authoritative filePath et al.) or null.
export async function revalidateAiVaultResumeEntry(
  entry: AgentLaunchVaultResumeEntry,
  discover: DiscoverAiVaultSessions
): Promise<VaultResumeSession | null> {
  const discovered = await discoverForEntry(entry, discover)
  return findVaultResumeSession(entry, discovered.sessions)
}

// Desktop 'copy' vault-resume: re-validate + assemble the copyable command. The
// command is a pure clipboard artifact; a session the host did not discover is an
// in-band invalid_launch_snapshot, never a substituted current command.
async function resolveAiVaultResumeCopyCommand(
  entry: AgentLaunchVaultResumeEntry,
  discover: DiscoverAiVaultSessions,
  settings: VaultResumeAssemblySettings | undefined
): Promise<VaultResumeCopyResult> {
  const discovered = await discoverForEntry(entry, discover)
  return resolveVaultResumeCopyCommand({
    entry,
    sessions: discovered.sessions,
    hostPlatform: process.platform,
    settings
  })
}

// Register the host-owned copy-command IPC. The renderer echoes a discovered
// entry's identity and the host re-validates + assembles the string, so the
// client no longer builds the launch itself.
export function registerAiVaultResumeCommandHandler(
  discover: DiscoverAiVaultSessions,
  getSettings?: () => VaultResumeAssemblySettings | undefined
): void {
  ipcMain.handle(
    'aiVault:resumeCommand',
    (_event, entry: AgentLaunchVaultResumeEntry): Promise<VaultResumeCopyResult> =>
      resolveAiVaultResumeCopyCommand(entry, discover, getSettings?.())
  )
}
