// Zod schema for the nested `agentLaunch` request accepted by terminal-create
// RPC methods (U3). A CUSTOM agent id is admitted only on this sanctioned path
// (`selection.agent` via isTuiAgent); the legacy `launchAgent`/`agent` fields
// stay built-in-only. The host constructs LaunchIntent/AgentReferenceAuthority
// from its authenticated context — never from this payload.

import { z } from 'zod'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/types'
import type { AgentLaunchSpawnRequest } from '../../../../shared/agent-launch-spawn-request'

const AgentLaunchSelection = z.union([
  z.object({
    kind: z.literal('agent'),
    agent: z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown agent' })
  }),
  z.object({ kind: z.literal('default') })
])

const AgentLaunchSourceRecord = z.object({
  owner: z.enum([
    'default',
    'quick-command',
    'commit-message',
    'source-control-recipe',
    'session',
    'workspace'
  ]),
  id: z.string().min(1).max(256).optional()
})

export const AgentLaunchSpawnRequestSchema: z.ZodType<AgentLaunchSpawnRequest> = z.object({
  selection: AgentLaunchSelection,
  prompt: z.string().max(100_000).optional(),
  allowEmptyPromptLaunch: z.boolean().optional(),
  promptDelivery: z.enum(['submit', 'draft']).optional(),
  sourceRecord: AgentLaunchSourceRecord.optional()
})
