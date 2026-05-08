# SSH worktree parity for `--no-track` + `push.autoSetupRemote`

## Status: proposed (2026-05-08)

## Summary

PR #1563 changes **local** `addWorktree` (`src/main/git/worktree.ts`) to (a) pass `--no-track` to `git worktree add` and (b) write `push.autoSetupRemote=true` per-repo, so unpublished worktree branches don't show "behind by N" in `git status` and a plain `git push` still self-publishes. The **SSH-relay** worktree creation path (`src/relay/git-handler.ts`) does not yet do either — it still passes `--track` (when the base ref is remote) and never touches `push.autoSetupRemote`.

This doc proposes bringing the SSH path to parity in the same PR rather than as a follow-up. The core argument is that the local-only fix introduces a behavior divergence between local and remote worktrees that is **caused by this PR**. Closing it in the same PR keeps the user-visible behavior of "Orca creates a worktree" uniform across local and SSH transports.

## Why this matters

Before PR #1563, both transports had the same UX warts:
- `git status` in a fresh worktree showed "behind by N" against the base ref (because `--track` was the default).
- First `git push` required `-u` (because `push.autoSetupRemote` was unset).

After the PR ships local-only:
- Local repo → fresh worktree status is clean; plain `git push` self-publishes.
- SSH-mounted repo → fresh worktree still says "behind by N"; plain `git push` still errors with "no upstream".

The two paths exist because Orca runs git locally for local repos and ships git invocations through an SSH multiplexer to a relay binary on the remote host for remote repos. Users don't see the path; they just see "create a worktree" in the UI. A divergence here means the same product feature behaves differently based on a transport detail the user shouldn't have to think about.

This is not a pre-existing bug we're choosing to ignore — it is **caused by this PR landing**. Bundling the SSH change with the local change keeps the diff a coherent semantic statement: "Orca-created worktrees use `--no-track` and ensure `push.autoSetupRemote=true`", applied wherever Orca creates worktrees.

## Non-goals

- We are not adding a setting to control `--no-track` or `push.autoSetupRemote`. The local PR already settled on these defaults; the SSH path inherits them.
- We are not adding remote-side `extensions.worktreeConfig` handling. As with local, `--local` writes from a linked worktree go to the shared common-dir config. That's accepted in the local PR's design comment and inherits here.
- We are not changing the relay protocol shape (`git.addWorktree` request payload). We are removing the optional `track` field, which is documented below as backwards-compatible.

## Alternatives considered

Two alternatives were rejected before settling on the proposed approach. They are recorded here so a future reader does not re-derive them.

### Alt A: Move `push.autoSetupRemote` probe-and-write to the client over `git.exec`

The shape: leave the relay handler at one line of change (always pass `--no-track`), and have `worktree-remote.ts` run the probe-and-write itself by calling `provider.exec(['config', '--get', ...])` and `provider.exec(['config', '--local', '...', 'true'])`. A shared helper would back both the local and SSH paths.

**Why it's not viable.** The relay's `git.exec` IPC is intentionally read-only for `config`. `src/relay/git-exec-validator.ts:107-113` rejects `git config` invocations that lack a read-only flag (`--get`, `--get-all`, `--list`, `--get-regexp`, `-l`) and explicitly denies write flags (`--add`, `--unset`, `--replace-all`, etc.). The `--local set true` write Alt A needs is exactly the operation that policy blocks. Weakening that validator to allow a single key would create a precedent for carving holes in the read-only-`git.exec` boundary every time a future feature wants a config write — exactly the kind of erosion the validator was added to prevent. So Alt A would require either (a) a special-cased `git.config.write` IPC method on the relay, or (b) loosening `git-exec-validator`. Either way, the relay grows a new write capability; the only question is what it's called. Given that, doing the probe-and-write inside `addWorktree` (which already does git writes through its own validated path) is the smaller surface-area change.

### Alt B: Shared helper module imported by both `src/main` and `src/relay`

The shape: extract `applyAutoSetupRemote(execGit, cwd)` to a new module (e.g. `src/shared/git/worktree-defaults.ts`) so the local helper and the relay handler import the same code.

**Why it's not viable today.** The relay binary is built as its own bundle target with no precedent for cross-importing from `src/main`. Other relay-side utilities (`src/relay/git-handler-utils.ts`, `src/relay/git-handler-ops.ts`) are local to the relay directory. Adding a `src/shared/git/` import path that both bundle entrypoints can pull from is a build-system change with non-trivial risk (circular deps, broken standalone packaging of the relay). The duplication-elimination win is real but small (~25 lines, identical state machine), and is not worth the structural change in this PR. If a third caller emerges, revisit.

## Design

### 1. Relay handler (`src/relay/git-handler.ts:303-328`)

Today:

```ts
private async addWorktree(params: Record<string, unknown>) {
  // ...
  const args = ['worktree', 'add']
  if (track) {
    args.push('--track')
  }
  args.push('-b', branchName, targetDir)
  if (base) {
    args.push(base)
  }
  await this.git(args, repoPath)
}
```

Proposed: mirror the local flow.

```ts
private async addWorktree(params: Record<string, unknown>) {
  const repoPath = params.repoPath as string
  this.context.validatePath(repoPath)
  const branchName = params.branchName as string
  const targetDir = params.targetDir as string
  this.context.validatePath(targetDir)
  const base = params.base as string | undefined

  if (branchName.startsWith('-') || (base && base.startsWith('-'))) {
    throw new Error('Branch name and base ref must not start with "-"')
  }

  // Why: --no-track + push.autoSetupRemote=true mirrors local addWorktree.
  // Inherited invariants (do not change casually):
  // - Warn-only on write failure; old git (<2.37) ignores the value and
  //   the user falls back to `git push -u` once.
  // - `--local` on a linked worktree writes to the shared common-dir
  //   config (not per-worktree). Benign and idempotent — every
  //   Orca-created worktree wants the same default.
  // - Skip the write when the key is already set at any scope so a
  //   deliberate user `false` is preserved.
  // - Not rolled back on creation failure: a future creation re-checks
  //   the value and no-ops if already set.
  // (See local addWorktree in src/main/git/worktree.ts for full rationale.)
  const args = ['worktree', 'add', '--no-track', '-b', branchName, targetDir]
  if (base) {
    args.push(base)
  }
  await this.git(args, repoPath)

  // Best-effort: warn-only on failure, same semantics as local.
  try {
    let alreadySet = false
    try {
      await this.git(['config', '--get', 'push.autoSetupRemote'], targetDir)
      alreadySet = true
    } catch (readError) {
      const code = (readError as { code?: unknown })?.code
      if (code !== 1) {
        throw readError
      }
    }
    if (!alreadySet) {
      await this.git(
        ['config', '--local', 'push.autoSetupRemote', 'true'],
        targetDir
      )
    }
  } catch (error) {
    console.warn(
      `relay addWorktree: failed to set push.autoSetupRemote for ${targetDir}`,
      error
    )
  }
}
```

Notes:

- The `track` param read is removed entirely. See section 4 for why this is safe.
- `code !== 1` discrimination is identical to local. `git config --get` exits 1 only when the key is unset at every scope; any other non-zero exit means a real read failure (corrupt config, locked file, parse error) and we must NOT fall through to `--local set`.
- The probe runs inside the worktree directory (`targetDir`), same as local. This is what surfaces values set at any scope (local/global/system) and lets us preserve a user-set `false`.
- Failures are warn-only. The same fallback applies as local: old git (<2.37) ignores the value and `git push -u` works once.
- The write happens inside `addWorktree` rather than via `git.exec` because `git-exec-validator` blocks config writes by design (see "Alt A" above). `addWorktree` is already an authorized-write entry point, so colocating the config write here costs no new trust surface.

### 2. Provider interface (`src/main/providers/types.ts:154-159`)

Today:

```ts
addWorktree(
  repoPath: string,
  branchName: string,
  targetDir: string,
  options?: { base?: string; track?: boolean }
): Promise<void>
```

Proposed:

```ts
addWorktree(
  repoPath: string,
  branchName: string,
  targetDir: string,
  options?: { base?: string }
): Promise<void>
```

Removing `track` because:
- Only one caller passes it (`worktree-remote.ts:164-167`).
- The relay handler no longer reads it (section 1).
- Keeping a parameter the caller can set but the handler ignores is a footgun — silently no-ops would mislead future callers.

### 3. SSH provider implementation (`src/main/providers/ssh-git-provider.ts:94-106`)

Spread of `...options` becomes `{ base }` only — trivial.

### 4. Caller (`src/main/ipc/worktree-remote.ts:164-167`)

Today:

```ts
await provider.addWorktree(repo.path, branchName, remotePath, {
  base: baseBranch,
  track: baseBranch.includes('/')
})
```

Proposed:

```ts
await provider.addWorktree(repo.path, branchName, remotePath, {
  base: baseBranch
})
```

The `baseBranch.includes('/')` heuristic was attempting to detect "remote-tracking ref" by string shape ("contains slash" → assume `origin/main`). It is no longer needed because the relay always passes `--no-track`.

### 5. Tests

**`src/relay/git-handler.test.ts`** — add coverage for the new flow:

- happy path: argv contains `--no-track`, two follow-up `config` calls (`--get` exits 1, `--local set true` runs).
- existing value preserved: `--get` succeeds, no `--local set`.
- corrupt-config short-circuit: `--get` exits 3, no `--local set`, warning logged.
- write failure is warn-only: `--local set` rejects, function still resolves.

This mirrors the local test set in `src/main/git/worktree.test.ts:209-285`. We don't need to re-test every branch of the state machine — local already covers the matrix; relay tests just need to confirm the same shape ships through this call site.

**`src/main/providers/ssh-git-provider.test.ts:147-155`** — verify the existing assertion already omits `track` (it does — the test passes `{ base: 'main' }` and asserts the request payload contains only `{ repoPath, branchName, targetDir, base }`). No update needed.

## Cross-version compatibility

There are two version-skew dimensions worth being explicit about.

### Old relay binary, new client

If a user upgrades the Orca client to this PR but the SSH relay on their remote host is still on an older binary, the old relay will:
- Still receive `git.addWorktree` requests (protocol shape unchanged besides the optional `track` field, which the new client no longer sends).
- Read `track` as `undefined`, fall through the `if (track)` guard, and run `git worktree add -b ...` with the **old** behavior (no `--track`, no `--no-track`).

Net result on an old relay: the new branch defaults to whatever stock git's behavior is for `worktree add -b ... <base>` — historically that does set up tracking when `<base>` is a remote ref. So old relays still produce the pre-PR behavior, which is the same as today's main. **No regression.** Once the user's relay binary is upgraded, they pick up the new behavior.

We are deliberately not adding a client-side fallback: the failure mode of "old relay → old behavior" is exactly what the user has today, and adding fallback complexity to detect relay version isn't worth it.

### New relay binary, old client

If the relay updates first and the client lags, the old client will send `track: baseBranch.includes('/')`. The new relay handler ignores `params.track` entirely, so the field is silently dropped. The new behavior (`--no-track` + autoSetupRemote) ships regardless. Acceptable — the change is a strict improvement.

## Risks and how they're mitigated

| Risk | Likelihood | Mitigation |
|---|---|---|
| Remote git is older than 2.37 → `push.autoSetupRemote=true` is ignored | Likely on long-lived remote dev hosts | Warn-only on write failure; on read of an unsupported key git just exits 1 (unset), so we fall through and write. The terminal `git push` falls back to "no upstream" error and `git push -u` works. Same fallback as local on old git. |
| Relay's `git config --local` from a linked worktree writes to common-dir config and persists past worktree removal | Same as local — the design comment in `src/main/git/worktree.ts:198-221` already documents this trade-off. The value is benign and idempotent. | Inherit the same comment in the relay handler. No behavioral change vs. local. |
| Probe-and-write doubles relay round trips per worktree creation (1 → 3 git invocations) | Low — the relay batches over the same SSH connection, and worktree creation is interactive (user-initiated, not on a hot path). | Acceptable cost for parity. If it becomes a measured problem, we can collapse to a single bash-shell relay call. |
| A user with `extensions.worktreeConfig=true` on the remote sees `--local` go to per-worktree config rather than common-dir | Same as local — design accepts this | No mitigation needed; behavior is benign in both modes. |
| Removing `track` from the public provider interface breaks an unknown caller | Very low — only one in-tree caller; provider is internal | Type system catches removed field at compile time. |
| Relay-side warn on `push.autoSetupRemote` write failure is invisible to the user | Low-to-medium — Orca does not surface relay-process stderr, so a silent failure looks identical to success until the user runs `git push` and gets "no upstream" | Same `git push -u` fallback as local on old git; the user-visible failure mode is identical to the pre-2.37 case. The warn lands on the relay host's stderr for postmortem debugging. |

## Test plan

- [ ] Unit: relay handler tests cover the four flow branches (write happens, existing value preserved, corrupt-config short-circuit, write fails warn-only).
- [ ] Unit: `ssh-git-provider.test.ts` already omits `track` from assertions — confirm no update needed.
- [ ] Unit: `worktree-remote.ts` no longer references `track`.
- [ ] Type check: removing `track?: boolean` from `Provider.addWorktree` should produce 0 type errors (only one caller).
- [ ] Live (if a remote test target is available): create a worktree via Orca against an SSH-mounted repo, run `git status` in the new worktree (no "behind by N" line), then `git push` in the worktree's terminal and confirm `origin/<branch>` is created and tracking is set.

If a live SSH test target isn't reachable in the dev environment, the unit-level coverage plus the cross-version compatibility analysis above are sufficient — the relay code path is structurally identical to the already-verified local code path.

## Out of scope

- Renderer-side ahead/behind UI: the deletion-impact reviewer confirmed Orca's own ahead/behind logic in `src/main/git/status.ts:510` and `src/relay/git-handler-ops.ts:182` uses explicit `merge-base` refs, never the worktree branch's `@{u}`. So removing the upstream pre-publish does not silently break sync indicators.
- The `extensions.worktreeConfig` mode: design comment on the local PR already covers this; no change needed in this doc.
- Migration of existing SSH worktrees that were created with `--track` before this PR. They keep their existing upstream — no rewrite. Only newly-created worktrees pick up the new behavior.
