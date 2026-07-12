// Host-side AI Vault resume assembly (U5 FULL PORT of the renderer's
// buildAiVaultResumeStartupForWorktree). The client only echoes a discovered
// entry's identity; the host re-validates it against its OWN fresh discovery and
// rebuilds the resume command here, bypassing the resolver like legacy opaque
// replay (no admission token/receipt). The renderer helper deliberately encodes
// semantics the structured resolver does not model — remote-verbatim resume,
// OMP absolute-transcript resume, and WSL Codex-home rewrite — so this is a
// faithful replication, not a re-derivation.
//
// The only renderer-specific piece dropped in the port is the AppState platform
// heuristic (WSL/workspace probing): the host already knows the spawning target
// platform, and a session may only resume on a target matching its own host, so
// a non-local entry uses the discovered host platform and a local one uses the
// spawning host's platform directly.

import {
  buildAiVaultResumeCommand,
  buildAiVaultResumeShellCommand,
  type AiVaultSession
} from '../../shared/ai-vault-types'
import {
  isResumableTuiAgent,
  type SleepingAgentLaunchConfig
} from '../../shared/agent-session-resume'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../shared/tui-agent-launch-defaults'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { resolveWindowsShellStartupFamily } from '../../shared/windows-terminal-shell'
import { buildAgentResumeStartupPlan } from '../../shared/tui-agent-startup'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import type { TuiAgent } from '../../shared/types'
import type {
  AgentLaunchVaultResumeCopyResult,
  AgentLaunchVaultResumeEntry
} from '../../shared/agent-launch-spawn-request'

/** Re-exported for host callers that assemble the copy result. */
export type VaultResumeCopyResult = AgentLaunchVaultResumeCopyResult

/** The fresh discovery slice the assembly reads. Sourced from the host's own
 *  `listAiVaultSessions`, never from the client — the client's echoed identity is
 *  only used to look this up (its `filePath` is ignored and re-derived here). */
export type VaultResumeSession = Pick<
  AiVaultSession,
  'agent' | 'sessionId' | 'cwd' | 'codexHome' | 'executionHostId'
> &
  Partial<Pick<AiVaultSession, 'executionHostPlatform' | 'resumeCommand' | 'filePath'>>

/** Host settings the assembly reads. Built-in-keyed records are assignable to the
 *  wider TuiAgent-keyed helper params (all keys optional). */
export type VaultResumeAssemblySettings = {
  agentCmdOverrides?: Partial<Record<TuiAgent, string>>
  agentDefaultArgs?: Partial<Record<TuiAgent, string>>
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>>
  terminalWindowsShell?: string
}

export type VaultResumeStartup = {
  command: string
  env?: Record<string, string>
  launchConfig?: SleepingAgentLaunchConfig
}

/** Re-validate the client-echoed entry against the host's OWN fresh discovery.
 *  A session whose {executionHostId, agent, sessionId} the host did not itself
 *  discover — or a field mismatch — returns null (→ invalid_launch_snapshot). */
export function findVaultResumeSession<S extends VaultResumeSession>(
  entry: AgentLaunchVaultResumeEntry,
  sessions: readonly S[]
): S | null {
  return (
    sessions.find(
      (session) =>
        session.executionHostId === entry.executionHostId &&
        session.agent === entry.agent &&
        session.sessionId === entry.sessionId
    ) ?? null
  )
}

/** Re-validate + assemble the copyable resume command for a client-echoed entry.
 *  Shared by the desktop IPC and runtime RPC copy surfaces; the caller supplies
 *  its own fresh discovery and the spawning host platform. */
export function resolveVaultResumeCopyCommand(args: {
  entry: AgentLaunchVaultResumeEntry
  sessions: readonly VaultResumeSession[]
  hostPlatform: NodeJS.Platform
  settings?: VaultResumeAssemblySettings
}): VaultResumeCopyResult {
  const session = findVaultResumeSession(args.entry, args.sessions)
  if (!session) {
    return { status: 'failed', failure: { code: 'invalid_launch_snapshot' } }
  }
  return {
    status: 'ok',
    command: buildVaultResumeStartup({
      session,
      hostPlatform: args.hostPlatform,
      settings: args.settings
    }).command
  }
}

/** Build the resume startup for a re-validated (host-discovered) session. */
export function buildVaultResumeStartup(args: {
  session: VaultResumeSession
  /** The spawning host's platform, used only for local sessions; a non-local
   *  session uses its own discovered host platform. */
  hostPlatform: NodeJS.Platform
  settings?: VaultResumeAssemblySettings
}): VaultResumeStartup {
  const { session, hostPlatform, settings } = args
  const commandOverride = settings?.agentCmdOverrides?.[session.agent as TuiAgent] ?? null
  const isRemote = !!session.executionHostId && session.executionHostId !== LOCAL_EXECUTION_HOST_ID
  // Remote-verbatim: a remote host stamped a ready-to-run resume command at
  // discovery time; replay it as-is rather than re-deriving remote semantics.
  if (isRemote && session.resumeCommand && !commandOverride?.trim()) {
    return { command: session.resumeCommand }
  }
  const platform: NodeJS.Platform =
    isRemote && session.executionHostPlatform ? session.executionHostPlatform : hostPlatform
  const codexHome = resolveVaultResumeCodexHome(session.codexHome ?? null, platform)
  // Why: the queued command is typed verbatim into a freshly spawned tab whose
  // live shell is the configured Windows shell (default PowerShell). Hardcoding
  // cmd quoting made PowerShell mis-parse the `""`-doubled wrapper (#6152), so
  // resolve the actual shell to quote per-shell instead.
  const queuedShell: AgentStartupShell | undefined =
    platform === 'win32'
      ? resolveWindowsShellStartupFamily(settings?.terminalWindowsShell)
      : undefined
  if (isResumableTuiAgent(session.agent)) {
    const startupPlan = buildAgentResumeStartupPlan({
      agent: session.agent,
      providerSession: { key: 'session_id', id: session.sessionId },
      cmdOverrides: {
        ...settings?.agentCmdOverrides,
        ...(commandOverride?.trim() ? { [session.agent]: commandOverride } : {})
      },
      platform,
      shell: queuedShell,
      agentArgs: resolveTuiAgentLaunchArgs(session.agent, settings?.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(session.agent, settings?.agentDefaultEnv)
    })
    if (startupPlan) {
      return {
        command: buildAiVaultResumeShellCommand({
          resumeCommand: startupPlan.launchCommand,
          cwd: session.cwd,
          platform,
          codexHome,
          shell: queuedShell
        }),
        ...(startupPlan.env ? { env: startupPlan.env } : {}),
        launchConfig: startupPlan.launchConfig
      }
    }
  }

  return {
    command: buildAiVaultResumeCommand({
      agent: session.agent,
      sessionId: session.sessionId,
      // Why: OMP resumes by absolute transcript path, so local rebuilds must
      // forward the host-derived path — an id-prefix lookup scoped to the default
      // store would miss a custom OMP_CODING_AGENT_DIR / WSL-store session.
      resumeFilePath: session.filePath,
      cwd: session.cwd,
      platform,
      commandOverride,
      codexHome,
      // Why: non-resumable agents queue through this fallback too, so it must
      // quote for the live Windows shell like the startup-plan branch above.
      shell: queuedShell
    })
  }
}

function resolveVaultResumeCodexHome(
  codexHome: string | null,
  platform: NodeJS.Platform
): string | null {
  // Why: WSL UNC Codex homes must be POSIX when invoking Linux commands. Keep
  // original paths unchanged for non-Linux targets.
  if (!codexHome || platform !== 'linux') {
    return codexHome
  }
  return parseWslUncPath(codexHome)?.linuxPath ?? codexHome
}
