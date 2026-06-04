# Display Empty Project Worktree Card

## Problem

Projects can disappear from the left sidebar when their `worktreesByRepo[repoId]` entry is empty. `WorktreeList` computes visible worktree rows from `computeVisibleWorktreeIds` and maps only those IDs back to `Worktree` objects, so an empty project produces no `worktrees` input for the row builder ([`src/renderer/src/components/sidebar/WorktreeList.tsx:3856`](../src/renderer/src/components/sidebar/WorktreeList.tsx#L3856)). The later placeholder repo logic only runs when `projectGroups.length > 0`, so ungrouped users do not get a repo header/card placeholder for the project ([`src/renderer/src/components/sidebar/WorktreeList.tsx:3984`](../src/renderer/src/components/sidebar/WorktreeList.tsx#L3984)).

`buildRows` has a `placeholderRepoIds` argument, but the current implementation also consumes it only when project groups exist ([`src/renderer/src/components/sidebar/worktree-list-groups.ts:485`](../src/renderer/src/components/sidebar/worktree-list-groups.ts#L485)). Imported-worktree candidates can independently create an empty repo group, but only for git repos with hidden authoritative external worktrees and passing visibility settings; they cannot cover a plain empty project or a folder repo ([`src/renderer/src/components/sidebar/imported-worktrees-card-candidates.ts:26`](../src/renderer/src/components/sidebar/imported-worktrees-card-candidates.ts#L26)).

## Root Cause

Empty-project visibility is incorrectly coupled to project-group rendering in two places: `WorktreeList` does not compute placeholder IDs without project groups, and `buildRows` ignores placeholder IDs without project groups. Empty projects need a repo placeholder in repo grouping even when no project groups exist. Otherwise `rows.length` can become zero and the sidebar falls through to "No workspaces found" even though a project exists.

## Non-goals

- Do not change project add, clone, fetch, or git worktree detection behavior.
- Do not display empty projects in non-repo grouping modes (`none`, workspace status, PR status), where there is no project header surface.
- Do not change imported/external worktree visibility rules.
- Do not redesign the card/header UI or introduce new style tokens.

## Design

1. In `WorktreeList`, compute placeholder repo IDs for every `groupBy === 'repo'` render, regardless of whether project groups exist. The memo/helper should not depend on `projectGroups`.
2. In `buildRows`, after real unpinned repo groups are created, insert `placeholderRepoIds` that resolve in `repoMap` and do not already have a group. Do this whenever `groupBy === 'repo'`, before imported-worktree candidates are merged and before project-group nesting is applied, so imported cards can attach to the same header instead of creating a duplicate.
3. Source placeholder candidates from `repos`, not `worktreesByRepo` keys, so removed repos do not leave stale headers and newly fetched repo records can render before their worktree scan finishes. Imported-worktree candidates already carry their own `repo`.
4. Keep existing repo filter behavior: if `filterRepoIds` is active, only selected empty projects should be eligible for placeholder rows.
5. Treat only repos with zero known worktrees as empty: `(worktreesByRepo[repo.id]?.length ?? 0) === 0`. Do not show placeholders for non-empty repos whose rows are hidden by sleeping/default-branch filters; those filters should keep using the existing empty/clear-filters behavior.
6. Keep `buildRows` as the authority for ordering, collapse behavior, project-group nesting, and imported-worktree card placement. The caller should only pass placeholder candidate IDs.
7. Do not pass `visibleWorktrees` to `buildImportedWorktreesCardCandidates` as part of this fix. The current caller intentionally lets imported-worktree cards survive workspace-row filters, and the tests cover that behavior.
8. Do not add an IPC/RPC fetch to prove emptiness, and do not cache placeholder IDs outside the render/store snapshot. This is a pure derivation from current `repos` and `worktreesByRepo`; runtime/SSH and multi-window updates should flow through the existing store refresh path.

## Edge Cases

- A filtered sidebar with an empty selected project should show that project; an empty unselected project should stay hidden.
- A repo with known worktrees hidden by active workspace filters should not get a placeholder header that makes the filter look successful.
- A repo with only pinned known worktrees is not empty and should keep the existing pinned/imported-worktree fallback behavior instead of gaining an unpinned repo placeholder.
- Collapsed repo headers should still hide child rows/imported cards, as they do today.
- Project groups should keep their current placeholder behavior and nesting depth.
- Imported-worktree cards should still render for empty projects when their existing candidate rules pass.
- SSH repos should work through the same repo IDs; do not assume local filesystem paths.
- Folder-mode projects with zero worktree rows should get the same placeholder as git projects because the issue is repo visibility, not git detection.
- A repo present in `repos` with no `worktreesByRepo[repo.id]` key should be treated as empty for this render; if worktree rows arrive later, the next store update removes the placeholder.
- A stale placeholder ID passed directly to `buildRows` must be skipped when `repoMap` cannot resolve it; do not render an `Unknown` repo header for this path.
- Under recent/smart ordering, empty placeholders have no visible child rank. Append them after repos with visible worktree rows, preserving `repos` order for the empty set.
- If project groups load after repos, an empty repo should first render ungrouped and then move under its group when `projectGroups` updates.
- If a worktree is created, imported, archived, or deleted in another window or through a runtime repo, the next `worktreesByRepo`/`repos` store update should recompute placeholder IDs and remove or add the placeholder without a separate IPC/RPC call.

## Rollout

1. Add or adjust a pure helper for deciding empty-project placeholder repo IDs, with inputs limited to `groupBy`, `repos`, `worktreesByRepo`, and `filterRepoIds`.
2. Update `WorktreeList` to use that helper whenever `groupBy === 'repo'`.
3. Update `buildRows` so `placeholderRepoIds` are consumed for repo grouping independent of `projectGroups.length`.
4. Add unit coverage for empty ungrouped projects, missing `worktreesByRepo` keys, repo filtering, project-group preservation, stale placeholder IDs absent from `repoMap`, and no placeholder for non-empty repos whose rows are hidden by filters.
5. Add a `WorktreeList` render regression for an ungrouped `repos: [repo]` / `worktreesByRepo: { [repo.id]: [] }` state: the repo label renders and "No workspaces found" does not. Add the filtered-out variant that still shows Clear Filters.
6. Run the focused sidebar tests, then `pnpm typecheck` and `pnpm lint`.
