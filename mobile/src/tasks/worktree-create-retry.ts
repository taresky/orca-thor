import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { WORKTREE_CREATE_TIMEOUT_MS } from './workspace-create-timeout'

// Why: server-side collision checks (branch already exists locally / on a remote
// / already has PR #N) can fire even after a pre-flight basename dedupe —
// branches outlive worktrees in git, and remote branches/PRs aren't visible from
// worktree.ps. Retry by appending -2, -3, ... mirroring the desktop createWorktree
// loop in src/renderer/src/store/slices/worktrees.ts.
export const WORKTREE_NAME_COLLISION_PATTERNS = [
  /already exists locally/i,
  /already exists on a remote/i,
  /already has pr #\d+/i,
  // Older runtimes emit a bare `Branch "x" already exists.`; mirrors the desktop
  // createWorktree loop (src/renderer/src/store/slices/worktrees.ts).
  /^Branch ".+" already exists\./i
]

const MAX_NAME_ATTEMPTS = 25

export type WorktreeCreateResult = { worktreeId: string; name: string } | { error: string }

// Creates a worktree, retrying with a numeric suffix on a name-collision error.
// buildParams receives the candidate name so callers can assemble source-specific
// params (linked issue/PR, base branch, etc.) around it. Callers that can't clear
// a collision by re-suffixing (e.g. reusing a fixed existing branch) pass
// maxAttempts: 1 to fail fast instead of burning the full retry budget.
export async function createWorktreeWithNameRetry(args: {
  client: RpcClient
  baseName: string
  buildParams: (name: string) => Record<string, unknown>
  maxAttempts?: number
}): Promise<WorktreeCreateResult> {
  const { client, baseName, buildParams } = args
  const maxAttempts = args.maxAttempts ?? MAX_NAME_ATTEMPTS
  let lastError: string | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidateName = attempt === 0 ? baseName : `${baseName}-${attempt + 1}`
    const response = await client.sendRequest('worktree.create', buildParams(candidateName), {
      timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
    })
    if (response.ok) {
      const result = (response as RpcSuccess).result as { worktree: { id: string } }
      return { worktreeId: result.worktree.id, name: candidateName }
    }
    lastError = response.error.message
    if (!WORKTREE_NAME_COLLISION_PATTERNS.some((pattern) => pattern.test(lastError ?? ''))) {
      break
    }
  }
  return { error: lastError ?? 'Failed to create workspace' }
}
