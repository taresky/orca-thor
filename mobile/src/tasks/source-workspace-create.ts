import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { shouldResolveHostedReviewStartPoint } from './hosted-review-start-point'
import { resolveMobileWorkspaceCreateName } from './mobile-workspace-name'
import {
  buildTaskWorkspaceCreateParams,
  type WorkspaceCreateHostedStartPoint,
  type WorkspaceCreateSetupDecision
} from './workspace-create-params'
import type { WorkspaceAgentChoice } from './workspace-agent-selection'
import type { WorkspaceSource } from './workspace-source-selection'
import { createWorktreeWithNameRetry, type WorktreeCreateResult } from './worktree-create-retry'

// The agent bundle the modal already resolved: the choice drives buildTaskWorkspaceCreateParams
// for task sources; the explicit launch command is used for branch sources (which
// have no work-item URL to seed the agent draft).
export type WorkspaceCreateAgentBundle = {
  choice: WorkspaceAgentChoice
  startupCommand: string | undefined
}

type NonBlankSource = Exclude<WorkspaceSource, { kind: 'blank' }>

export async function createWorkspaceFromSource(args: {
  client: RpcClient
  source: NonBlankSource
  targetRepoId: string
  setupDecision: WorkspaceCreateSetupDecision
  agent: WorkspaceCreateAgentBundle
  workspaceName: string | undefined
  note: string | undefined
}): Promise<WorktreeCreateResult> {
  const { source } = args
  if (source.kind === 'branch' || source.kind === 'new-branch') {
    return createBranchWorkspace({ ...args, source })
  }
  return createTaskWorkspace({ ...args, source })
}

async function createTaskWorkspace(args: {
  client: RpcClient
  source: Extract<NonBlankSource, { kind: 'task' }>
  targetRepoId: string
  setupDecision: WorkspaceCreateSetupDecision
  agent: WorkspaceCreateAgentBundle
  workspaceName: string | undefined
  note: string | undefined
}): Promise<WorktreeCreateResult> {
  const { client, source, targetRepoId, setupDecision, agent, workspaceName, note } = args

  let hostedStartPoint: WorkspaceCreateHostedStartPoint | undefined
  if (
    (source.hostedType === 'pr' || source.hostedType === 'mr') &&
    shouldResolveHostedReviewStartPoint({ type: source.hostedType })
  ) {
    hostedStartPoint = await resolveHostedStartPoint(client, source)
  }

  const params = buildTaskWorkspaceCreateParams({
    item: source.item,
    targetRepoId,
    setupDecision,
    agent: agent.choice,
    workspaceName,
    note,
    hostedStartPoint
  })
  // buildTaskWorkspaceCreateParams computes the name; reuse it as the retry base so
  // collisions still append -2, -3, ... like the blank path does.
  const baseName = String(params.name)
  return createWorktreeWithNameRetry({
    client,
    baseName,
    buildParams: (name) => ({ ...params, name })
  })
}

// Faithful port of the PR/MR base-resolve in mobile/app/h/[hostId]/tasks.tsx: the
// runtime returns either a start point or a soft { error } payload (not an RPC error).
async function resolveHostedStartPoint(
  client: RpcClient,
  source: Extract<NonBlankSource, { kind: 'task' }>
): Promise<WorkspaceCreateHostedStartPoint> {
  const item = source.item
  if (item.provider === 'linear') {
    // Unreachable: only github/gitlab pr/mr sources resolve a hosted base.
    throw new Error('Linear sources do not resolve a hosted base branch')
  }
  const method = item.provider === 'github' ? 'worktree.resolvePrBase' : 'worktree.resolveMrBase'
  const numberKey = item.provider === 'github' ? 'prNumber' : 'mrIid'
  const branchKey = item.provider === 'github' ? 'headRefName' : 'sourceBranch'
  const params: Record<string, unknown> = {
    repo: `id:${item.source.repoId}`,
    [numberKey]: item.source.number,
    ...(source.branchName ? { [branchKey]: source.branchName } : {}),
    ...(source.isCrossRepository !== undefined
      ? { isCrossRepository: source.isCrossRepository }
      : {})
  }
  const response = await client.sendRequest(method, params, { timeoutMs: 30_000 })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const result = (response as RpcSuccess).result as
    | WorkspaceCreateHostedStartPoint
    | { error: string }
  if ('error' in result) {
    throw new Error(result.error)
  }
  return result
}

async function createBranchWorkspace(args: {
  client: RpcClient
  source: Extract<NonBlankSource, { kind: 'branch' | 'new-branch' }>
  targetRepoId: string
  setupDecision: WorkspaceCreateSetupDecision
  agent: WorkspaceCreateAgentBundle
  workspaceName: string | undefined
  note: string | undefined
}): Promise<WorktreeCreateResult> {
  const { client, source, targetRepoId, setupDecision, agent, workspaceName, note } = args
  const createdWithAgentId = agent.choice === 'blank' ? undefined : agent.choice
  const comment = note?.trim()
  const applyCommon = (params: Record<string, unknown>): Record<string, unknown> => {
    if (createdWithAgentId) {
      params.createdWithAgent = createdWithAgentId
    }
    if (comment) {
      params.comment = comment
    }
    return params
  }

  if (source.kind === 'new-branch') {
    // New branch: the retry base is the branch name so a collision bumps the
    // branch itself (the colliding constraint), not just the display name. An
    // empty baseRef leaves baseBranch unset so the runtime picks the default base.
    const baseBranch = source.baseRefName
    const displayNameOverride = workspaceName?.trim()
    return createWorktreeWithNameRetry({
      client,
      baseName: source.branchName,
      buildParams: (candidateBranch) => {
        const params: Record<string, unknown> = {
          repo: `id:${targetRepoId}`,
          name: displayNameOverride || candidateBranch,
          setupDecision,
          branchNameOverride: candidateBranch,
          startupCommand: agent.startupCommand
        }
        if (baseBranch) {
          params.baseBranch = baseBranch
        }
        return applyCommon(params)
      }
    })
  }

  // Existing branch: reuse the branch off its ref. branchNameOverride is fixed to
  // the reused branch, so a branch collision (e.g. it's checked out elsewhere)
  // can't be cleared by suffixing the display name — fail fast instead of
  // retrying 25 identical creates.
  const baseName = resolveMobileWorkspaceCreateName({
    draft: workspaceName,
    fallback: source.localBranchName
  })
  return createWorktreeWithNameRetry({
    client,
    baseName,
    maxAttempts: 1,
    buildParams: (name) =>
      applyCommon({
        repo: `id:${targetRepoId}`,
        name,
        setupDecision,
        baseBranch: source.refName,
        branchNameOverride: source.localBranchName,
        startupCommand: agent.startupCommand
      })
  })
}
