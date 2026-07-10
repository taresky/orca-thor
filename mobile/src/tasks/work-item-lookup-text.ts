import { parseGitHubIssueOrPRNumber } from '../../../src/shared/new-workspace/github-links'
import { parseGitLabIssueOrMRNumber } from '../../../src/shared/new-workspace/gitlab-links'

const LINEAR_ISSUE_URL_RE = /^https?:\/\/(?:www\.)?linear\.app\/\S+/i
const LINEAR_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

// Why: text typed to *find* a work item — a GitHub/GitLab URL, "#123", or a
// Linear link/identifier — is a lookup query, never a deliberate name. Selection
// handlers use this to decide the resolved item's title-derived name may replace
// the field content; otherwise the pasted reference silently survives behind the
// pill and the workspace gets a slugified-URL name. Mirrors desktop's
// isWorkItemLookupText using the shared link parsers.
export function isWorkItemLookupText(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  return (
    parseGitHubIssueOrPRNumber(trimmed) !== null ||
    parseGitLabIssueOrMRNumber(trimmed) !== null ||
    LINEAR_ISSUE_URL_RE.test(trimmed) ||
    LINEAR_IDENTIFIER_RE.test(trimmed)
  )
}
