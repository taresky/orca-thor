import type { GitHubWorkItem, GitLabWorkItem, LinearIssue } from '../../../src/shared/types'
import {
  getLinearIssueWorkspaceName,
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName
} from '../../../src/shared/workspace-name'
import { getLinearOrganizationUrlKeyFromIssueUrl } from '../../../src/shared/linear-links'
import { isWorkItemLookupText } from './work-item-lookup-text'
import {
  isBranchCheckedOutInWorktrees,
  resolveComposerBranchReuse,
  resolveComposerBranchSelection,
  resolveComposerReuseOverride
} from '../../../src/shared/composer-branch-selection'
import type {
  MobileComposerCreateSelection,
  MobileLinkedWorkItem,
  SmartNameSelection
} from './mobile-composer-source-types'
import type { WorkspaceCreateGitPushTarget } from './workspace-create-params'

export function buildGitHubLinkedWorkItem(item: {
  type: 'issue' | 'pr'
  number: number
  title: string
  url: string
  repoId: string
}): MobileLinkedWorkItem {
  return {
    provider: 'github',
    type: item.type,
    number: item.number,
    title: item.title,
    url: item.url,
    repoId: item.repoId
  }
}

export function buildGitLabLinkedWorkItem(item: {
  type: 'issue' | 'mr'
  number: number
  title: string
  url: string
  repoId: string
}): MobileLinkedWorkItem {
  return {
    provider: 'gitlab',
    type: item.type,
    number: item.number,
    title: item.title,
    url: item.url,
    repoId: item.repoId
  }
}

export function buildLinearLinkedWorkItem(issue: {
  identifier: string
  title: string
  url: string
  workspaceId?: string
}): MobileLinkedWorkItem {
  const orgUrlKey = getLinearOrganizationUrlKeyFromIssueUrl(issue.url)
  return {
    provider: 'linear',
    type: 'issue',
    number: 0,
    title: issue.title,
    url: issue.url,
    linearIdentifier: issue.identifier,
    ...(issue.workspaceId ? { linearWorkspaceId: issue.workspaceId } : {}),
    ...(orgUrlKey ? { linearOrganizationUrlKey: orgUrlKey } : {})
  }
}

// Faithful port of desktop applyLinkedWorkItem's name gate: the derived name
// replaces the current field only when it's empty, still the last auto-name, or
// a lookup query — never a name the user deliberately typed.
export function shouldApplyAutoName(args: { currentName: string; lastAutoName: string }): boolean {
  return (
    !args.currentName.trim() ||
    args.currentName === args.lastAutoName ||
    isWorkItemLookupText(args.currentName)
  )
}

export function resolveWorkItemAutoName(item: {
  type: 'issue' | 'pr' | 'mr'
  number: number
  title: string
  provider: 'github' | 'gitlab' | 'linear'
  linearIdentifier?: string
}): string {
  return getLinkedWorkItemWorkspaceName(item)?.seedName ?? getLinkedWorkItemSuggestedName(item)
}

export function resolveLinearAutoName(issue: { identifier: string; title: string }): string {
  return getLinearIssueWorkspaceName(issue)
}

// Derives the pill descriptor from the linked item (or a plain branch base),
// mirroring desktop's smartNameSelection memo.
export function buildSmartNameSelection(args: {
  linkedWorkItem: MobileLinkedWorkItem | null
  baseBranch: string | undefined
}): SmartNameSelection | null {
  const { linkedWorkItem, baseBranch } = args
  if (linkedWorkItem) {
    const isLinear = linkedWorkItem.provider === 'linear'
    const kind: SmartNameSelection['kind'] = isLinear
      ? 'linear'
      : linkedWorkItem.provider === 'gitlab'
        ? linkedWorkItem.type === 'mr'
          ? 'gitlab-mr'
          : 'gitlab-issue'
        : linkedWorkItem.type === 'pr'
          ? 'github-pr'
          : 'github-issue'
    return {
      kind,
      label:
        isLinear || linkedWorkItem.number === 0
          ? linkedWorkItem.title
          : `#${linkedWorkItem.number} ${linkedWorkItem.title}`,
      url: linkedWorkItem.url
    }
  }
  if (baseBranch) {
    return { kind: 'branch', label: baseBranch }
  }
  return null
}

// Derives the create-time selection from composer state: a linked work item wins
// (carrying its resolved base/push fields), else a picked branch, else null (a
// name-only/blank create).
export function resolveComposerCreateSelection(args: {
  linkedWorkItem: MobileLinkedWorkItem | null
  base: {
    baseBranch?: string
    compareBaseRef?: string
    pushTarget?: WorkspaceCreateGitPushTarget
    branchNameOverride?: string
  }
  branch: { refName: string; localBranchName: string } | null
  reuseEligibleBranch: string | null
  reuseSelectedBranch: boolean
  branchCreateIntent: boolean
  name: string
}): MobileComposerCreateSelection | null {
  const { linkedWorkItem, base, branch, reuseEligibleBranch, reuseSelectedBranch } = args
  if (linkedWorkItem) {
    return {
      kind: 'work-item',
      item: linkedWorkItem,
      baseBranch: base.baseBranch,
      compareBaseRef: base.compareBaseRef,
      pushTarget: base.pushTarget,
      branchNameOverride: base.branchNameOverride
    }
  }
  if (branch && base.baseBranch) {
    return {
      kind: 'branch',
      baseBranch: base.baseBranch,
      refName: branch.refName,
      localBranchName: branch.localBranchName,
      reuse: reuseSelectedBranch && reuseEligibleBranch === branch.localBranchName,
      branchNameOverride: base.branchNameOverride
    }
  }
  if (args.branchCreateIntent && args.name.trim()) {
    return { kind: 'new-branch', branchName: args.name.trim() }
  }
  return null
}

export type ComposerBranchPick = {
  base: { baseBranch: string; branchNameOverride?: string }
  reuseEligibleBranch: string | null
  reuseSelectedBranch: boolean
  name?: string
  lastAutoName?: string
}

// Pure port of desktop handleSmartBranchSelect's derivation: base + reuse
// eligibility/default + the auto-name to apply, from the shared branch helpers.
export function resolveComposerBranchPick(args: {
  refName: string
  localBranchName: string
  currentName: string
  lastAutoName: string
  worktreeBranches: readonly string[]
}): ComposerBranchPick {
  const { refName, localBranchName } = args
  const selection = resolveComposerBranchSelection({
    refName,
    localBranchName,
    currentName: args.currentName,
    lastAutoName: args.lastAutoName
  })
  const branchCheckedOutElsewhere = isBranchCheckedOutInWorktrees(
    localBranchName,
    args.worktreeBranches
  )
  const { reuseEligibleBranch, defaultReuse } = resolveComposerBranchReuse({
    refName,
    localBranchName,
    selectionProducedOverride: selection.branchNameOverride !== undefined,
    branchCheckedOutElsewhere
  })
  const effectiveOverride = resolveComposerReuseOverride({
    refName,
    localBranchName,
    branchNameOverride: selection.branchNameOverride,
    branchCheckedOutElsewhere
  })
  return {
    base: { baseBranch: selection.baseBranch, branchNameOverride: effectiveOverride },
    reuseEligibleBranch,
    reuseSelectedBranch: defaultReuse,
    ...(selection.name !== undefined && selection.lastAutoName !== undefined
      ? { name: selection.name, lastAutoName: selection.lastAutoName }
      : {})
  }
}

export type { GitHubWorkItem, GitLabWorkItem, LinearIssue }
