import { resolveTelemetryAgentKind } from '@/lib/telemetry-agent-kind'
import type { WorktreeStartupPayload } from '@/lib/worktree-activation'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { TuiAgent } from '../../../shared/types'
import type { AgentLaunchSpawnRequest } from '../../../shared/agent-launch-spawn-request'

/**
 * Build the identity-only agent-launch startup for a direct "Use work item"
 * create. The renderer owns the primary tab the activation seeds, so the agent
 * spawns through the `pty:spawn` agentLaunch path once that tab mounts: the host
 * resolves command/config/token/env and — when the prompt can't fold into the
 * launch — returns the text for the readiness-gated paste writer to deliver.
 * The client never assembles a command, args, or env.
 */
export function buildDirectWorkItemAgentLaunchStartup(args: {
  agent: TuiAgent
  draftContent: string
  promptDelivery: 'draft' | 'submit-after-ready'
  launchSource: LaunchSource
}): WorktreeStartupPayload {
  const hasPrompt = args.draftContent.trim().length > 0
  const agentLaunch: AgentLaunchSpawnRequest = hasPrompt
    ? {
        selection: { kind: 'agent', agent: args.agent },
        prompt: args.draftContent,
        // Why: 'submit-after-ready' submits the prompt once the TUI is ready. The
        // host owns fold-vs-paste (folding it into argv, or returning followupPrompt
        // for a post-ready submit), so the client maps to 'submit' and never decides.
        promptDelivery: args.promptDelivery === 'submit-after-ready' ? 'submit' : 'draft'
      }
    : { selection: { kind: 'agent', agent: args.agent }, allowEmptyPromptLaunch: true }
  return {
    command: '',
    launchAgent: args.agent,
    agentLaunch,
    telemetry: {
      agent_kind: resolveTelemetryAgentKind(args.agent),
      launch_source: args.launchSource,
      request_kind: 'new'
    }
  }
}
