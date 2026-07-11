// The authoritative agent-launch resolver. Pure CPU: no fs, subprocess, network,
// or listeners (I15) — every host-produced input arrives in the request. Returns
// a fully resolved launch, a typed launch failure, or a request/control-plane
// error; never null, never a throw for expected lifecycle state.

import type { GlobalSettings } from '../../shared/types'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { resolveStartupShell } from '../../shared/tui-agent-startup-shell'
import type { AgentCatalog } from '../../shared/agent-catalog-normalization'
import type {
  AgentLaunchResolution,
  AgentLaunchSnapshot,
  ResolveAgentLaunchRequest
} from '../../shared/agent-launch-host-contract'
import type { AgentLaunchRequestError } from '../../shared/agent-launch-contract'
import { resolveSelection } from './resolve-agent-selection'
import { buildLaunchContext } from './resolve-agent-launch-context'
import { assembleCommand } from './resolve-agent-command'
import { prepareVariableValues } from './resolve-agent-variables'
import { clientOfIntent } from './resolve-agent-env-admission'
import { checkCommandTooLong, checkEnvPayloadTooLarge } from './agent-launch-payload-caps'
import { buildResolvedLaunch, type LaunchTarget } from './resolve-agent-launch-result'

export type ResolveAgentLaunchOutcome =
  | AgentLaunchResolution
  | { ok: false; requestError: AgentLaunchRequestError }

function hasUserPathOverride(env: Record<string, string>): boolean {
  return Object.keys(env).some((key) => key.toLowerCase() === 'path')
}

function deriveTarget(request: ResolveAgentLaunchRequest): LaunchTarget {
  return {
    platform: request.platform,
    execution: request.executionHostId.startsWith('wsl:') ? 'wsl' : 'native',
    shell: resolveStartupShell(request.platform, request.shell),
    isRemote: request.isRemote,
    executionHostId: request.executionHostId
  }
}

function targetMatchesSnapshot(target: LaunchTarget, snapshot: AgentLaunchSnapshot): boolean {
  return (
    snapshot.target.platform === target.platform &&
    snapshot.target.execution === target.execution &&
    snapshot.target.shell === target.shell &&
    snapshot.target.isRemote === target.isRemote &&
    snapshot.target.executionHostId === target.executionHostId
  )
}

/** Replay a validated snapshot: argv/env come from the immutable snapshot, not
 *  the current definition (U5 owns the definition-changed comparison). Fails
 *  closed on identity/target mismatch. */
function replayFromSnapshot(
  request: ResolveAgentLaunchRequest,
  target: LaunchTarget
): ResolveAgentLaunchOutcome {
  const snapshot = request.persistedSnapshot
  if (!snapshot) {
    return { ok: false, failure: { code: 'invalid_launch_snapshot' } }
  }
  if (request.selection.kind === 'agent' && request.selection.agent !== snapshot.requestedAgent) {
    return { ok: false, failure: { code: 'invalid_launch_snapshot', reason: 'identity_mismatch' } }
  }
  if (!targetMatchesSnapshot(target, snapshot)) {
    return { ok: false, failure: { code: 'invalid_launch_snapshot' } }
  }
  const env = Object.create(null) as Record<string, string>
  for (const key of Object.keys(snapshot.agentEnv)) {
    env[key] = snapshot.agentEnv[key]
  }
  // Confidential transport is a current gate that constrains replay: captured
  // env never crosses hosts on an authenticated-but-plaintext channel.
  if (Object.keys(env).length > 0 && request.transportConfidentialityAvailable === false) {
    return {
      ok: false,
      failure: {
        code: 'secure_env_transport_unavailable',
        requestedAgent: snapshot.requestedAgent,
        baseAgent: snapshot.baseAgent
      }
    }
  }
  return {
    ok: true,
    launch: buildResolvedLaunch({
      mode: snapshot.mode,
      requestedAgent: snapshot.requestedAgent,
      baseAgent: snapshot.baseAgent,
      displayLabel: snapshot.displayLabel,
      argv: [...snapshot.argv] as unknown as typeof snapshot.argv,
      env,
      envPolicy: Object.keys(env).length > 0 ? 'full' : 'none',
      referenced: [],
      values: { repoPath: null, worktreePath: null },
      notices: [],
      target,
      targetHomePath: request.targetHomePath ?? null,
      intentKind: request.intent.kind,
      client: clientOfIntent(request.intent),
      config: TUI_AGENT_CONFIG[snapshot.baseAgent],
      basis: 'snapshot',
      definitionDigestSource: { replaySnapshot: snapshot.argv },
      transportConfidential: request.transportConfidentialityAvailable ?? null
    })
  }
}

/** Resolve a launch request against the normalized catalog and current settings. */
export function resolveAgentLaunch(
  request: ResolveAgentLaunchRequest,
  catalog: AgentCatalog,
  settings: GlobalSettings
): ResolveAgentLaunchOutcome {
  const selection = resolveSelection(request, catalog)
  if (selection.kind === 'failure') {
    return { ok: false, failure: selection.failure }
  }
  if (selection.kind === 'request-error') {
    return { ok: false, requestError: selection.requestError }
  }

  const target = deriveTarget(request)

  if (selection.decision.launch === 'replay-snapshot') {
    return replayFromSnapshot(request, target)
  }

  const client = clientOfIntent(request.intent)
  const context = buildLaunchContext(selection.decision, catalog, settings, client)
  const values = prepareVariableValues(request.variables, target.execution)

  // Env may cross to a different terminal host only inside an authenticated,
  // confidential channel; it never downgrades to plaintext or silently drops
  // values. Env-free launches may continue over a non-confidential channel.
  if (Object.keys(context.env).length > 0 && request.transportConfidentialityAvailable === false) {
    return {
      ok: false,
      failure: {
        code: 'secure_env_transport_unavailable',
        requestedAgent: context.requestedAgent,
        baseAgent: context.baseAgent
      }
    }
  }

  const command = assembleCommand({
    config: context.config,
    platform: request.platform,
    isRemote: request.isRemote,
    shell: target.shell,
    targetHomePath: request.targetHomePath ?? null,
    commandOverride: context.commandOverride,
    prefixOverride: context.prefixOverride,
    argsTemplate: context.argsTemplate,
    isCustomArgs: context.isCustomArgs,
    envValues: Object.keys(context.env).map((key) => context.env[key]),
    values
  })
  if (!command.ok) {
    return { ok: false, failure: command.failure }
  }

  // Stock-name detection gates only stock catalog argv with no accepted user PATH
  // override; configured/custom prefixes and custom PATH env cannot be evaluated
  // by name detection and proceed to preflight/spawn.
  if (
    command.prefixSource === 'catalog' &&
    request.detectedStockBaseAgents !== null &&
    !request.detectedStockBaseAgents.has(context.baseAgent) &&
    !hasUserPathOverride(context.env)
  ) {
    return { ok: false, failure: { code: 'base_agent_unavailable', baseAgent: context.baseAgent } }
  }

  const commandCap = checkCommandTooLong(command.argv, target.shell)
  if (commandCap) {
    return { ok: false, failure: commandCap }
  }
  const envCap = checkEnvPayloadTooLarge(command.argv, context.env, target)
  if (envCap) {
    return { ok: false, failure: envCap }
  }

  return {
    ok: true,
    launch: buildResolvedLaunch({
      mode: context.mode,
      requestedAgent: context.requestedAgent,
      baseAgent: context.baseAgent,
      displayLabel: context.displayLabel,
      argv: command.argv,
      env: context.env,
      envPolicy: context.envPolicy,
      referenced: command.referenced,
      values,
      notices: context.notices,
      target,
      targetHomePath: request.targetHomePath ?? null,
      intentKind: request.intent.kind,
      client,
      config: context.config,
      basis: selection.basis,
      definitionDigestSource: context.definitionDigestSource,
      transportConfidential: request.transportConfidentialityAvailable ?? null
    })
  }
}
