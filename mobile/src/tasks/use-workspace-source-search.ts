import { useEffect, useRef, useState } from 'react'
import type { BaseRefSearchResult } from '../../../src/shared/types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { extractLinearIssueReadItems } from './linear-mobile-issue-read'
import { isGitHubWorkItemsSshRemoteRequiredError, PER_REPO_FETCH_LIMIT } from './mobile-work-items'
import {
  buildBranchSource,
  buildGitHubTaskSource,
  buildGitLabTaskSource,
  buildLinearTaskSource,
  type WorkspaceSource,
  type WorkspaceSourceTab
} from './workspace-source-selection'

const DEBOUNCE_MS = 250
const GITLAB_PER_PAGE = 50
const LINEAR_LIMIT = 50
const BRANCH_LIMIT = 20

export type WorkspaceSourceSearchResult = {
  id: string
  title: string
  subtitle: string
  status?: string
  source: WorkspaceSource
}

export type WorkspaceSourceSearchState = {
  results: WorkspaceSourceSearchResult[]
  loading: boolean
  error: string
  needsGitHubRemote: boolean
}

type GitHubSearchItem = {
  type: 'issue' | 'pr'
  number: number
  title: string
  url: string
  state?: string
  branchName?: string
  isCrossRepository?: boolean
}

type GitLabSearchItem = {
  type: 'issue' | 'mr'
  number: number
  title: string
  url: string
  state?: string
  branchName?: string
  isCrossRepository?: boolean
}

// Mirrors mobile Tasks' default issue scoping; a user can type `is:pr` to search
// pull requests instead.
function scopeGitHubQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) {
    return 'is:issue is:open'
  }
  if (/\bis:(?:issue|pr)\b/i.test(trimmed)) {
    return trimmed
  }
  return `is:issue ${trimmed}`
}

async function searchGitHub(
  client: RpcClient,
  repoId: string,
  query: string
): Promise<WorkspaceSourceSearchResult[]> {
  const response = await client.sendRequest('github.listWorkItems', {
    repo: `id:${repoId}`,
    limit: PER_REPO_FETCH_LIMIT,
    query: scopeGitHubQuery(query)
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const envelope = (response as RpcSuccess).result as { items: GitHubSearchItem[] }
  return envelope.items.map((item) => ({
    id: `github:${item.type}:${item.number}`,
    title: item.title,
    subtitle: `${item.type === 'pr' ? 'PR' : 'Issue'} #${item.number}`,
    status: item.state,
    source: buildGitHubTaskSource(repoId, {
      type: item.type,
      number: item.number,
      title: item.title,
      url: item.url,
      branchName: item.branchName,
      isCrossRepository: item.isCrossRepository
    })
  }))
}

async function searchGitLab(
  client: RpcClient,
  repoId: string,
  query: string
): Promise<WorkspaceSourceSearchResult[]> {
  const response = await client.sendRequest('gitlab.listWorkItems', {
    repo: `id:${repoId}`,
    state: 'opened',
    page: 1,
    perPage: GITLAB_PER_PAGE,
    query: query.trim() || undefined
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const envelope = (response as RpcSuccess).result as {
    items: GitLabSearchItem[]
    error?: { type?: string; message: string }
  }
  if (envelope.error?.type && envelope.error.type !== 'not_found') {
    throw new Error(envelope.error.message)
  }
  return envelope.items.map((item) => ({
    id: `gitlab:${item.type}:${item.number}`,
    title: item.title,
    subtitle: `${item.type === 'mr' ? 'MR !' : 'Issue #'}${item.number}`,
    status: item.state,
    source: buildGitLabTaskSource(repoId, {
      type: item.type,
      number: item.number,
      title: item.title,
      url: item.url,
      branchName: item.branchName,
      isCrossRepository: item.isCrossRepository
    })
  }))
}

async function searchLinear(
  client: RpcClient,
  query: string,
  linearWorkspaceId: string | null | undefined
): Promise<WorkspaceSourceSearchResult[]> {
  const trimmed = query.trim()
  const response = trimmed
    ? await client.sendRequest('linear.searchIssues', {
        query: trimmed,
        limit: LINEAR_LIMIT,
        workspaceId: linearWorkspaceId ?? undefined
      })
    : await client.sendRequest('linear.listIssues', {
        filter: 'all',
        limit: LINEAR_LIMIT,
        workspaceId: linearWorkspaceId ?? undefined
      })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const issues = extractLinearIssueReadItems((response as RpcSuccess).result)
  return issues.map((issue) => ({
    id: `linear:${issue.identifier}`,
    title: issue.title,
    subtitle: `${issue.identifier} · ${issue.team?.key ?? 'Linear'}`,
    status: issue.state?.name,
    source: buildLinearTaskSource({
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url
    })
  }))
}

async function searchBranches(
  client: RpcClient,
  repoId: string,
  query: string
): Promise<WorkspaceSourceSearchResult[]> {
  const response = await client.sendRequest(
    'repo.searchRefs',
    { repo: `id:${repoId}`, query: query.trim(), limit: BRANCH_LIMIT },
    { timeoutMs: 30_000 }
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  const result = (response as RpcSuccess).result as {
    refDetails?: BaseRefSearchResult[]
    refs?: string[]
  }
  const refs =
    result.refDetails ??
    (result.refs ?? []).map((refName) => ({ refName, localBranchName: refName }))
  return refs.map((ref) => ({
    id: `branch:${ref.refName}`,
    title: ref.localBranchName || ref.refName,
    subtitle: ref.refName,
    source: buildBranchSource(ref.refName, ref.localBranchName)
  }))
}

function runSearch(args: {
  client: RpcClient
  activeTab: WorkspaceSourceTab
  query: string
  repoId: string | null
  linearWorkspaceId: string | null | undefined
}): Promise<WorkspaceSourceSearchResult[]> {
  const { client, activeTab, query, repoId, linearWorkspaceId } = args
  if (activeTab === 'linear') {
    return searchLinear(client, query, linearWorkspaceId)
  }
  if (!repoId) {
    return Promise.resolve([])
  }
  if (activeTab === 'github') {
    return searchGitHub(client, repoId, query)
  }
  if (activeTab === 'gitlab') {
    return searchGitLab(client, repoId, query)
  }
  return searchBranches(client, repoId, query)
}

// Runs a debounced, single-repo provider search for the workspace source picker.
// A stale-closure guard drops out-of-order results when the tab/query changes.
export function useWorkspaceSourceSearch(args: {
  client: RpcClient | null
  enabled: boolean
  activeTab: WorkspaceSourceTab
  query: string
  repoId: string | null
  linearWorkspaceId?: string | null
}): WorkspaceSourceSearchState {
  const { client, enabled, activeTab, query, repoId, linearWorkspaceId } = args
  const [state, setState] = useState<WorkspaceSourceSearchState>({
    results: [],
    loading: false,
    error: '',
    needsGitHubRemote: false
  })
  // Why: preserve results across keystrokes (avoids flicker under debounce) but
  // drop them the moment the tab or repo changes, so one provider's rows never
  // render under another provider's tab.
  const scopeRef = useRef('')

  useEffect(() => {
    if (!client || !enabled) {
      setState({ results: [], loading: false, error: '', needsGitHubRemote: false })
      return
    }
    // Repo-scoped tabs can't search without a repo; branch search needs a query.
    if (activeTab !== 'linear' && !repoId) {
      setState({ results: [], loading: false, error: '', needsGitHubRemote: false })
      return
    }
    if (activeTab === 'branch' && !query.trim()) {
      setState({ results: [], loading: false, error: '', needsGitHubRemote: false })
      return
    }

    const scope = `${activeTab}:${repoId ?? ''}`
    const scopeChanged = scopeRef.current !== scope
    scopeRef.current = scope

    let stale = false
    setState((prev) => ({
      results: scopeChanged ? [] : prev.results,
      loading: true,
      error: '',
      needsGitHubRemote: false
    }))
    const timer = setTimeout(() => {
      void runSearch({ client, activeTab, query, repoId, linearWorkspaceId })
        .then((results) => {
          if (!stale) {
            setState({ results, loading: false, error: '', needsGitHubRemote: false })
          }
        })
        .catch((err) => {
          if (stale) {
            return
          }
          if (activeTab === 'github' && isGitHubWorkItemsSshRemoteRequiredError(err)) {
            setState({ results: [], loading: false, error: '', needsGitHubRemote: true })
            return
          }
          setState({
            results: [],
            loading: false,
            error: err instanceof Error ? err.message : 'Search failed',
            needsGitHubRemote: false
          })
        })
    }, DEBOUNCE_MS)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [client, enabled, activeTab, query, repoId, linearWorkspaceId])

  return state
}
