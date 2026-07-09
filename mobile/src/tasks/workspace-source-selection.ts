import type { WorkspaceCreateTaskItem } from './workspace-create-params'

// The tabs a user can start a workspace from, mirroring the desktop composer's
// smart-name source modes (branch / GitHub / GitLab / Linear). "Blank" is the
// implicit default and isn't a tab.
export type WorkspaceSourceTab = 'branch' | 'github' | 'gitlab' | 'linear'

// Slim inputs: only the fields the create flow needs from each provider's work
// item. The picker builds these from the richer search-result envelopes.
export type GitHubWorkItemInput = {
  type: 'issue' | 'pr'
  number: number
  title: string
  url: string
  branchName?: string
  isCrossRepository?: boolean
}

export type GitLabWorkItemInput = {
  type: 'issue' | 'mr'
  number: number
  title: string
  url: string
  branchName?: string
  isCrossRepository?: boolean
}

export type LinearIssueInput = {
  identifier: string
  title: string
  url: string
}

// Why: branchName/isCrossRepository ride alongside the trimmed
// WorkspaceCreateTaskItem because worktree.resolvePrBase/resolveMrBase need them
// but they aren't part of the create-item source shape.
export type WorkspaceSource =
  | { kind: 'blank' }
  | { kind: 'branch'; refName: string; localBranchName: string }
  | { kind: 'new-branch'; baseRefName: string; branchName: string }
  | {
      kind: 'task'
      item: WorkspaceCreateTaskItem
      hostedType: 'issue' | 'pr' | 'mr' | 'linear'
      branchName?: string
      isCrossRepository?: boolean
    }

export type WorkspaceSourceDescription = {
  label: string
  providerIconId?: WorkspaceSourceTab
}

export function buildGitHubTaskSource(repoId: string, item: GitHubWorkItemInput): WorkspaceSource {
  return {
    kind: 'task',
    hostedType: item.type,
    ...(item.branchName ? { branchName: item.branchName } : {}),
    ...(item.isCrossRepository !== undefined ? { isCrossRepository: item.isCrossRepository } : {}),
    item: {
      provider: 'github',
      source: {
        type: item.type,
        repoId,
        number: item.number,
        title: item.title,
        url: item.url
      }
    }
  }
}

export function buildGitLabTaskSource(repoId: string, item: GitLabWorkItemInput): WorkspaceSource {
  return {
    kind: 'task',
    hostedType: item.type,
    ...(item.branchName ? { branchName: item.branchName } : {}),
    ...(item.isCrossRepository !== undefined ? { isCrossRepository: item.isCrossRepository } : {}),
    item: {
      provider: 'gitlab',
      source: {
        type: item.type,
        repoId,
        number: item.number,
        title: item.title,
        url: item.url
      }
    }
  }
}

export function buildLinearTaskSource(item: LinearIssueInput): WorkspaceSource {
  return {
    kind: 'task',
    hostedType: 'linear',
    item: {
      provider: 'linear',
      source: {
        identifier: item.identifier,
        title: item.title,
        url: item.url
      }
    }
  }
}

export function buildBranchSource(refName: string, localBranchName: string): WorkspaceSource {
  return { kind: 'branch', refName, localBranchName }
}

export function buildNewBranchSource(baseRefName: string, branchName: string): WorkspaceSource {
  return { kind: 'new-branch', baseRefName, branchName }
}

export function describeWorkspaceSource(source: WorkspaceSource): WorkspaceSourceDescription {
  switch (source.kind) {
    case 'blank':
      return { label: 'Blank workspace' }
    case 'branch':
      return {
        label: `Branch: ${source.localBranchName || source.refName}`,
        providerIconId: 'branch'
      }
    case 'new-branch':
      return { label: `New branch: ${source.branchName}`, providerIconId: 'branch' }
    case 'task': {
      if (source.item.provider === 'github') {
        const item = source.item.source
        return { label: `#${item.number} ${item.title}`, providerIconId: 'github' }
      }
      if (source.item.provider === 'gitlab') {
        const item = source.item.source
        const prefix = item.type === 'mr' ? '!' : '#'
        return { label: `${prefix}${item.number} ${item.title}`, providerIconId: 'gitlab' }
      }
      const item = source.item.source
      return { label: `${item.identifier} ${item.title}`, providerIconId: 'linear' }
    }
  }
}

// The repo a source pins to: GitHub/GitLab work items dictate their own repo;
// Linear/branch/new-branch/blank defer to the modal's selected repo (null).
export function resolveSourceRepoId(source: WorkspaceSource): string | null {
  if (
    source.kind === 'task' &&
    (source.item.provider === 'github' || source.item.provider === 'gitlab')
  ) {
    return source.item.source.repoId
  }
  return null
}

// Whether a source is tied to a specific repo, so switching the modal's repo
// invalidates it. Branches are searched per-repo; GitHub/GitLab items pin a repo.
// Linear issues are repo-agnostic (the target repo is chosen separately), and
// blank has no repo dependency.
export function isRepoBoundSource(source: WorkspaceSource): boolean {
  if (source.kind === 'branch' || source.kind === 'new-branch') {
    return true
  }
  if (source.kind === 'task') {
    return source.item.provider !== 'linear'
  }
  return false
}
