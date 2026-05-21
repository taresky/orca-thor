# `base_ref_missing` workspace creation failures

This note is a handoff for investigating and fixing the `workspace_create_failed` telemetry bucket where `error_class = 'base_ref_missing'`.

## What It Means

`base_ref_missing` means Orca tried to create a new worktree/workspace, but could not resolve a base ref to branch from.

The local worktree path resolves the base in this order:

1. Explicit `baseBranch` from the caller.
2. Repo-level `worktreeBaseRef`, if configured.
3. `origin/HEAD`.
4. `origin/main`.
5. `origin/master`.
6. Local `main`.
7. Local `master`.

If all of those fail, worktree creation throws:

```text
Could not resolve a default base ref for this repo. Pass an explicit --base and try again.
```

That error is classified as `base_ref_missing` by `src/main/ipc/workspace-create-error-classifier.ts`.

Relevant code:

- `src/main/git/repo.ts`: `DEFAULT_BASE_REF_PROBES`, `getDefaultBaseRef`, `resolveDefaultBaseRefViaExec`.
- `src/main/runtime/orca-runtime.ts`: local runtime worktree creation, default-base resolution, remote-tracking base refresh.
- `src/main/ipc/worktree-remote.ts`: SSH/remote worktree creation default-base resolution.
- `src/main/ipc/worktrees.ts`: emits `workspace_create_failed`.
- `src/main/ipc/workspace-create-error-classifier.ts`: maps the thrown message to `base_ref_missing`.

## Likely User Situations

These are the likely product situations based on the code path and PostHog data:

- User adds a local repo/folder whose remote refs have not been fetched.
- Repo has no `origin` remote.
- `origin/HEAD` is unset.
- Repo's primary branch is not `main` or `master` and no Orca repo base ref is configured.
- Local-only repo is currently on a feature branch and has no local `main` or `master`.
- Onboarding/new-project setup tries to create a worktree immediately after repo add, before the user has any reason to configure a base branch.
- User retries the same failed create path repeatedly because the UI does not route them directly into base-ref selection.

This is not a source-app cohort issue. It is a worktree base-ref resolution issue.

## Current Data Snapshot

The current 30-day PostHog snapshot showed:

- `280` `base_ref_missing` failures across `70` installs.
- Very retry-heavy: `4.0` failures per affected install.
- `5` installs accounted for `104` failures.
- One install hit the failure `54` times in about an hour.
- `37 / 70` affected installs later created a workspace.
- `26 / 70` recovered within 1 hour.

By source:

| Source | Attempts | Successes | Failures | `base_ref_missing` | Failure rate | `base_ref_missing` rate |
|---|---:|---:|---:|---:|---:|---:|
| sidebar | 4,363 | 4,074 | 289 | 169 | 6.6% | 3.9% |
| onboarding | 692 | 593 | 99 | 88 | 14.3% | 12.7% |
| shortcut | 201 | 189 | 12 | 7 | 6.0% | 3.5% |
| command_palette | 98 | 87 | 11 | 11 | 11.2% | 11.2% |
| unknown | 66 | 61 | 5 | 5 | 7.6% | 7.6% |

By platform:

| Platform | Attempts | Successes | Failures | `base_ref_missing` | `base_ref_missing` rate |
|---|---:|---:|---:|---:|---:|
| darwin | 3,984 | 3,702 | 282 | 185 | 4.6% |
| win32 | 773 | 666 | 107 | 81 | 10.5% |
| linux | 663 | 636 | 27 | 14 | 2.1% |

The strongest read is that onboarding and Windows are disproportionately affected, but the issue is not limited to either one.

## How To Retrieve The Data

Use the Orca PostHog project, ID `406068`.

```bash
POSTHOG_TOKEN=$(jq -r .token ~/.posthog/credentials.json)
HOST=https://us.posthog.com
PROJECT=406068

run_query() {
  label="$1"
  query="$2"
  printf '\n### %s\n' "$label"
  jq -n --arg q "$query" '{query:{kind:"HogQLQuery",query:$q}}' \
    | curl -s \
      -H "Authorization: Bearer $POSTHOG_TOKEN" \
      -H "Content-Type: application/json" \
      -X POST "$HOST/api/projects/$PROJECT/query/" \
      -d @- \
    | jq '{results, columns, detail, error}'
}
```

### Attempts And Failure Rates By Source

```bash
run_query "workspace_create_attempt_rates_by_source" "
WITH attempts AS (
  SELECT
    distinct_id AS uid,
    event,
    coalesce(nullIf(toString(properties.source), ''), 'unknown') AS source,
    coalesce(nullIf(toString(properties.error_class), ''), 'success') AS outcome
  FROM events
  WHERE event IN ('workspace_created','workspace_create_failed')
    AND timestamp > now() - INTERVAL 30 DAY
)
SELECT
  source,
  count() AS attempts,
  countIf(event = 'workspace_created') AS successes,
  countIf(event = 'workspace_create_failed') AS failures,
  countIf(outcome = 'base_ref_missing') AS base_ref_missing_failures,
  count(DISTINCT uid) AS installs,
  round(100.0 * countIf(event = 'workspace_create_failed') / nullIf(count(), 0), 1) AS failure_rate_pct,
  round(100.0 * countIf(outcome = 'base_ref_missing') / nullIf(count(), 0), 1) AS base_ref_missing_rate_pct
FROM attempts
GROUP BY source
ORDER BY attempts DESC
"
```

### Attempts And Failure Rates By Platform

```bash
run_query "workspace_create_attempt_rates_by_platform" "
WITH attempts AS (
  SELECT
    distinct_id AS uid,
    event,
    coalesce(nullIf(toString(properties.platform), ''), 'unknown') AS platform,
    coalesce(nullIf(toString(properties.error_class), ''), 'success') AS outcome
  FROM events
  WHERE event IN ('workspace_created','workspace_create_failed')
    AND timestamp > now() - INTERVAL 30 DAY
)
SELECT
  platform,
  count() AS attempts,
  countIf(event = 'workspace_created') AS successes,
  countIf(event = 'workspace_create_failed') AS failures,
  countIf(outcome = 'base_ref_missing') AS base_ref_missing_failures,
  count(DISTINCT uid) AS installs,
  round(100.0 * countIf(outcome = 'base_ref_missing') / nullIf(count(), 0), 1) AS base_ref_missing_rate_pct
FROM attempts
GROUP BY platform
ORDER BY attempts DESC
"
```

### Failures By Source, Version, Platform

```bash
run_query "base_ref_missing_by_source_version_platform" "
SELECT
  coalesce(nullIf(toString(properties.source), ''), 'unknown') AS source,
  coalesce(nullIf(toString(properties.app_version), ''), 'unknown') AS app_version,
  coalesce(nullIf(toString(properties.platform), ''), 'unknown') AS platform,
  coalesce(nullIf(toString(properties.arch), ''), 'unknown') AS arch,
  count() AS failures,
  count(DISTINCT distinct_id) AS installs
FROM events
WHERE event = 'workspace_create_failed'
  AND properties.error_class = 'base_ref_missing'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY source, app_version, platform, arch
ORDER BY failures DESC
LIMIT 30
"
```

### Failures By Day

```bash
run_query "base_ref_missing_by_day" "
SELECT
  formatDateTime(timestamp, '%Y-%m-%d') AS day,
  count() AS failures,
  count(DISTINCT distinct_id) AS installs
FROM events
WHERE event = 'workspace_create_failed'
  AND properties.error_class = 'base_ref_missing'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day
"
```

### Repeat Failure And Recovery

```bash
run_query "base_ref_missing_recovery" "
WITH failures AS (
  SELECT
    distinct_id AS uid,
    min(timestamp) AS first_failure_at,
    count() AS failures,
    argMin(toString(properties.source), timestamp) AS source
  FROM events
  WHERE event = 'workspace_create_failed'
    AND properties.error_class = 'base_ref_missing'
    AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY uid
),
recovery AS (
  SELECT
    f.uid,
    countIf(e.event = 'workspace_created' AND e.timestamp > f.first_failure_at) AS later_workspace_created_events,
    countIf(e.event = 'repo_added' AND e.timestamp > f.first_failure_at) AS later_repo_added_events,
    countIf(
      e.event = 'workspace_created'
      AND e.timestamp > f.first_failure_at
      AND dateDiff('minute', f.first_failure_at, e.timestamp) <= 60
    ) AS workspace_created_1h
  FROM failures f
  LEFT JOIN events e ON e.distinct_id = f.uid AND e.timestamp > f.first_failure_at
  GROUP BY f.uid
)
SELECT
  count() AS installs,
  sum(failures) AS failures,
  countIf(later_workspace_created_events > 0) AS later_workspace_created_installs,
  countIf(workspace_created_1h > 0) AS recovered_workspace_1h,
  countIf(later_repo_added_events > 0) AS later_repo_added_installs
FROM failures f
LEFT JOIN recovery r ON f.uid = r.uid
"
```

### Repeat Failure Buckets

```bash
run_query "base_ref_missing_repeat_buckets" "
WITH failures AS (
  SELECT
    distinct_id AS uid,
    min(timestamp) AS first_failure_at,
    count() AS failures
  FROM events
  WHERE event = 'workspace_create_failed'
    AND properties.error_class = 'base_ref_missing'
    AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY uid
),
recovery AS (
  SELECT
    f.uid,
    countIf(e.event = 'workspace_created' AND e.timestamp > f.first_failure_at) AS later_workspace_created_events
  FROM failures f
  LEFT JOIN events e ON e.distinct_id = f.uid AND e.timestamp > f.first_failure_at
  GROUP BY f.uid
)
SELECT
  multiIf(failures = 1, '1', failures BETWEEN 2 AND 3, '2-3', failures BETWEEN 4 AND 9, '4-9', '10+') AS failure_count_bucket,
  count() AS installs,
  sum(failures) AS failures,
  countIf(later_workspace_created_events > 0) AS later_workspace_created_installs
FROM failures f
LEFT JOIN recovery r ON f.uid = r.uid
GROUP BY failure_count_bucket
ORDER BY failure_count_bucket
"
```

### Events Immediately Before First Failure

```bash
run_query "events_before_base_ref_missing" "
WITH failures AS (
  SELECT
    distinct_id AS uid,
    min(timestamp) AS failure_at
  FROM events
  WHERE event = 'workspace_create_failed'
    AND properties.error_class = 'base_ref_missing'
    AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY uid
),
prev AS (
  SELECT
    f.uid,
    argMax(e.event, e.timestamp) AS prev_event,
    argMax(toString(e.properties.action), e.timestamp) AS prev_action,
    argMax(toString(e.properties.source), e.timestamp) AS prev_source
  FROM failures f
  JOIN events e ON e.distinct_id = f.uid
  WHERE e.timestamp < f.failure_at
    AND e.timestamp >= f.failure_at - INTERVAL 30 MINUTE
    AND e.event != 'workspace_create_failed'
  GROUP BY f.uid
)
SELECT
  prev_event,
  prev_action,
  prev_source,
  count() AS installs
FROM prev
GROUP BY prev_event, prev_action, prev_source
ORDER BY installs DESC
LIMIT 25
"
```

## Fix Directions

Likely product/code fixes:

1. If default base resolution returns null, route the user into a base-ref picker instead of letting repeated create attempts fail.
2. In onboarding, proactively resolve the base ref after repo add and before showing project setup. If unresolved, show a compact "Choose base branch" step.
3. Add privacy-safe telemetry for the resolution reason. Do not send branch names. Good fields:
   - `base_ref_resolution`: `explicit | repo_config | origin_head | fallback_probe | unresolved`
   - `has_origin_remote`: boolean
   - `origin_head_set`: boolean
   - `fallback_probe_hit`: `origin_main | origin_master | local_main | local_master | none`
   - `base_ref_picker_shown`: boolean
   - `base_ref_picker_completed`: boolean
4. Add a recovery event or property so the dashboard can distinguish "blocked then fixed by choosing a base" from "blocked and abandoned."

Important: branch names and paths can identify repos, so keep telemetry low-cardinality and avoid raw ref names.
