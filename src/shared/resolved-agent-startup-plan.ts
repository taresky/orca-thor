// Startup-plan assembly from a host-resolved launch. Consumes ResolvedAgentLaunch
// policy instead of re-indexing TUI_AGENT_CONFIG or re-reading settings: the
// resolver already produced the complete structured argv, so this step only
// appends the prompt per the resolved injection mode and quotes each final argv
// element exactly once for the target shell. No caller may reparse, interpolate,
// or concatenate the result.

import type { ResolvedAgentLaunch } from './agent-launch-host-contract'
import type { AgentStartupPlan } from './tui-agent-startup'
import { buildShellCommandFromArgv, resolveStartupShell } from './tui-agent-startup-shell'
import { TUI_AGENT_CONFIG } from './tui-agent-config'

export type ResolvedAgentStartupPlanArgs = {
  launch: ResolvedAgentLaunch
  prompt: string
  allowEmptyPromptLaunch?: boolean
  launchToken?: string
}

function promptArgvFor(
  launch: ResolvedAgentLaunch,
  trimmedPrompt: string
): { argvSuffix: string[]; followupPrompt: string | null } {
  const mode = launch.policy.promptInjectionMode
  if (mode === 'argv') {
    const separator = TUI_AGENT_CONFIG[launch.baseAgent].argvPromptSeparator
    return {
      argvSuffix: separator ? [separator, trimmedPrompt] : [trimmedPrompt],
      followupPrompt: null
    }
  }
  if (mode === 'flag-prompt') {
    return { argvSuffix: ['--prompt', trimmedPrompt], followupPrompt: null }
  }
  if (mode === 'flag-prompt-interactive') {
    return { argvSuffix: ['--prompt-interactive', trimmedPrompt], followupPrompt: null }
  }
  if (mode === 'flag-interactive') {
    return { argvSuffix: ['-i', trimmedPrompt], followupPrompt: null }
  }
  // stdin-after-start: bare TUI launch; the readiness writer delivers the prompt.
  return { argvSuffix: [], followupPrompt: trimmedPrompt }
}

/** Build the single startup plan for a resolved launch. The prompt (when the
 *  injection mode takes one) is appended to a disposable argv copy exactly
 *  once; the immutable snapshot argv is never extended. */
export function buildAgentStartupPlanFromResolvedLaunch(
  args: ResolvedAgentStartupPlanArgs
): AgentStartupPlan | null {
  const { launch } = args
  const shell = resolveStartupShell(launch.policy.platform, launch.snapshot.target.shell)
  const trimmedPrompt = args.prompt.trim()

  const launchConfig = {
    agentCommand: buildShellCommandFromArgv(launch.argv, shell),
    agentArgs: '',
    // Why: only the admitted user agent env enters the durable resume config;
    // pane identity/prompt transport env is added later by the writer and must
    // never persist.
    agentEnv: { ...launch.agentEnv }
  }

  if (!trimmedPrompt && !(args.allowEmptyPromptLaunch ?? false)) {
    return null
  }

  const { argvSuffix, followupPrompt } = trimmedPrompt
    ? promptArgvFor(launch, trimmedPrompt)
    : { argvSuffix: [], followupPrompt: null }

  const finalArgv = [...launch.argv, ...argvSuffix]
  return {
    agent: launch.requestedAgent,
    launchCommand: buildShellCommandFromArgv(finalArgv, shell),
    expectedProcess: launch.policy.expectedProcess,
    followupPrompt,
    launchConfig,
    ...(args.launchToken ? { launchToken: args.launchToken } : {}),
    // Why: codex consumes an argv prompt only after its shell integration is
    // ready; matches the legacy plan's delivery selection for the same case.
    ...(launch.baseAgent === 'codex' &&
    trimmedPrompt &&
    launch.policy.promptInjectionMode === 'argv'
      ? { startupCommandDelivery: 'shell-ready' as const }
      : {}),
    ...(Object.keys(launch.agentEnv).length > 0 ? { env: { ...launch.agentEnv } } : {})
  }
}
