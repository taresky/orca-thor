# Review Context

## Branch Info

- Base: origin/main (merge-base fd86e1869a4520ad341748ac91deccfe1a40ecd4)
- Current: brennanb2025/fix-worktree-no-track

## Changed Files Summary

- M src/main/git/remove-worktree.test.ts
- M src/main/git/worktree.test.ts
- M src/main/git/worktree.ts
- M src/main/ipc/worktree-remote.ts
- M src/main/providers/ssh-git-provider.ts
- M src/main/providers/types.ts
- M src/relay/git-handler.test.ts
- M src/relay/git-handler.ts

## Changed Line Ranges (PR Scope)

<!-- In scope: issues on these lines OR caused by these changes. Out of scope: unrelated pre-existing issues -->

| File                                  | Changed Lines                                                              |
| ------------------------------------- | -------------------------------------------------------------------------- |
| src/main/git/remove-worktree.test.ts  | 428-435, 464-466                                                           |
| src/main/git/worktree.test.ts         | 210-212, 217-320, 333-334, 343-348, 361-362, 383-384, 401-402, 406-407, 411, 417-427, 432-434, 444, 446-453, 466-467 |
| src/main/git/worktree.ts              | 187-192, 197-249                                                           |
| src/main/ipc/worktree-remote.ts       | 165                                                                        |
| src/main/providers/ssh-git-provider.ts| 98                                                                         |
| src/main/providers/types.ts           | 158                                                                        |
| src/relay/git-handler.test.ts         | 1-4, 292-435                                                               |
| src/relay/git-handler.ts              | 1-5, 314 (deletion), 322-330, 336-367                                      |

## Review Standards Reference

- Follow /review-code standards
- Focus on: correctness, security, performance, maintainability
- Priority levels: Critical > High > Medium > Low

## File Categories

### Electron/Main (`src/main/`)

- src/main/git/remove-worktree.test.ts
- src/main/git/worktree.test.ts
- src/main/git/worktree.ts
- src/main/ipc/worktree-remote.ts
- src/main/providers/ssh-git-provider.ts
- src/main/providers/types.ts

### Backend/IPC (relay handler — process boundary)

- src/relay/git-handler.test.ts
- src/relay/git-handler.ts

### Frontend/UI

(none)

### Config/Build

(none)

### Utility/Common

(none)

## Skipped Issues (Do Not Re-validate)

<!-- Issues validated but deemed not worth fixing. Do not re-validate these in future iterations. -->
<!-- Format: [file:line-range] | [severity] | [reason skipped] | [issue summary] -->
<!-- NOTE: Skips should be RARE - only purely cosmetic issues with no functional impact -->

- `src/relay/git-handler.test.ts:311` | Low | cosmetic test-pattern preference, agent itself recommends leaving as-is | re-binding private `git` method via `(handler as unknown as { git })` cast — accepted Vitest pattern with justifying comment already present
- `src/relay/git-handler.ts:1-5` | Low | pure comment-style preference | reword "tipped this over the threshold" framing in eslint-disable max-lines justification

## Iteration State

<!-- Updated after each phase to enable crash recovery -->

Current iteration: 1
Last completed phase: Validation (4 fix, 2 skip, 0 FP)
Files fixed this iteration: []
