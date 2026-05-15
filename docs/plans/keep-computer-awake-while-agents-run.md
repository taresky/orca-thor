# Keep Computer Awake While Agents Run

## Goal

Add an optional setting that keeps the local computer awake while Orca sees at least one running agent status.

The setting defaults off. When enabled, Orca should prevent app suspension while any current non-stale status Orca has seen is `working`, and release the blocker as soon as no working statuses remain.

## Product Behavior

- Add a setting named `keepComputerAwakeWhileAgentsRun` to `GlobalSettings`.
- Default: `false`.
- Settings UI copy:
  - Label: `Keep computer awake when Orca sees agents running`
  - Description: `Prevents this computer from sleeping while Orca sees an agent working. The display can still turn off.`
- Count this hook-reported agent state as running:
  - `working`
- Do not count:
  - `blocked`
  - `waiting`
  - `done`
  - dismissed or dropped status rows
  - stale orphan statuses after a conservative timeout
- Use Electron's `powerSaveBlocker.start('prevent-app-suspension')`, not `prevent-display-sleep`, so the machine stays active but the screen may still sleep.

## Reference Notes

- VS Code exposes a default-off `remote.tunnels.access.preventSleep` setting for remote tunnel access in `remoteTunnel.contribution.ts`. The useful pattern is explicit user opt-in, application-scoped setting, and no display wake lock.
- VS Code's proposed environment power API documents `prevent-app-suspension` as keeping the system active while allowing the screen to turn off.
- Tabby starts Electron `powerSaveBlocker` for file uploads/downloads and owns the returned blocker id until the operation closes. The useful pattern is a single owner that starts once, keeps the id, and stops exactly once.

## Architecture

Implement the blocker in the main process. The renderer should expose the setting, but it should not own the wake lock.

Rationale:

- Electron `powerSaveBlocker` is a main-process API.
- Agent hook status already flows through main before renderer IPC.
- Main remains the right owner if the renderer is hidden, backgrounded, or recreated.
- SSH agent statuses arrive through the same main-side hook server, so local sleep prevention can cover remote sessions without assuming local-only execution.

Add a small main-process service, for example `src/main/agent-awake-service.ts`.

Responsibilities:

- Keep the current setting value.
- Track whether any current agent status is running.
- Subscribe to main-side agent status changes independently of renderer IPC fanout.
- Start `powerSaveBlocker` only when both are true:
  - `keepComputerAwakeWhileAgentsRun === true`
  - at least one status satisfies the canonical wake eligibility predicate
- Stop the blocker when either condition becomes false.
- Schedule a stale-boundary timer so a lone old `working` status is reevaluated even if no more hook events arrive.
- Stop the blocker during app shutdown.
- Treat the Electron blocker id as the authoritative active-lock handle. After start/stop attempts, reconcile with `powerSaveBlocker.isStarted(id)` when an id exists; if reconciliation fails, clear the local id only when Electron confirms the blocker is stopped or the id is no longer usable.
- Log structured non-telemetry diagnostics for start/stop/reconcile decisions, including enabled state, running-status count, stale-expiry reason, and blocker id lifecycle. Do not surface user-facing errors.

## Data Flow

1. Add `keepComputerAwakeWhileAgentsRun: boolean` to `GlobalSettings` in `src/shared/types.ts`.
2. Add `keepComputerAwakeWhileAgentsRun: false` to `getDefaultSettings()` in `src/shared/constants.ts`.
3. Add the toggle to `GeneralPane` or `AgentsPane`.
   - Preferred placement: `AgentsPane`, because the behavior is tied to agent execution rather than general app appearance.
   - Add search metadata in `agents-search.ts`.
4. Initialize `AgentAwakeService` in main startup with `store.getSettings()`.
5. When `settings:set` receives this key, update the service after `store.updateSettings(args)`.
6. Add a multi-subscriber status-change API to `AgentHookServer`, or an equivalent independent callback list, and have `AgentAwakeService` subscribe through it.
7. After hook-server startup hydration, initialize the service with an empty wake-eligible snapshot. Hydrated cached statuses may continue to serve renderer UI continuity, but they must not drive the wake lock until a fresh hook event is observed in the current main-process runtime.
8. Notify status-change subscribers after every `lastStatusByPaneKey` mutation that changes the snapshot, including hook event set, `dropStatusEntry`, and `clearPaneState` during PTY teardown or SSH cleanup. The service should refresh from the main-side status snapshot after each notification.
9. On window close, do not stop the blocker just because the renderer listener is detached. The service should follow agent status and settings, not window lifetime.

## Staleness Rule

Use a timeout to avoid keeping a laptop awake forever because of a stale cached status.

Canonical wake eligibility predicate:

- A status is eligible for this feature only if `observedInCurrentRuntime === true`, `state === 'working'`, and `Date.now() - receivedAt <= AGENT_AWAKE_STATUS_STALE_AFTER_MS`.
- Start with `AGENT_AWAKE_STATUS_STALE_AFTER_MS = 2 * 60 * 60 * 1000`.
- After every status refresh, schedule one timer for the earliest eligible running status expiry. When it fires, reevaluate the current snapshot and stop the blocker if all running statuses are stale.
- Clear and reschedule this timer whenever statuses change, the setting changes, or the service is disposed.

Why this is longer than the renderer's freshness UI window:

- Agent status pings are not guaranteed to arrive continuously during a long-running tool or command.
- The wake-lock behavior should prioritize not sleeping during real long agent work.
- The timeout still bounds orphaned statuses from crashes or missed teardown.

If this feels too permissive after testing, make the timeout smaller only after confirming long tool calls emit fresh status events often enough.

## Main-Process Integration Details

Add service methods:

```ts
type AgentAwakeStatus = {
  state: 'working' | 'blocked' | 'waiting' | 'done'
  receivedAt: number
  observedInCurrentRuntime: boolean
}

class AgentAwakeService {
  setEnabled(enabled: boolean): void
  setStatuses(statuses: AgentAwakeStatus[]): void
  dispose(): void
}
```

The service should derive `shouldBlock` internally and avoid repeated Electron calls if the blocker is already in the desired state.

`setStatuses` should store the latest snapshot and schedule the next stale-boundary timer. The timer callback should only reevaluate the stored snapshot against the canonical wake eligibility predicate; it should not poll the renderer. Startup-hydrated statuses from disk should be passed with `observedInCurrentRuntime: false` or omitted from the wake-eligible snapshot; only hook events received after this main process starts should set `observedInCurrentRuntime: true`.

Integration points:

- `src/main/index.ts`
  - Create the service after the store is available.
  - After `agentHookServer.start(...)` has hydrated cached statuses, do not let the disk snapshot start a wake lock. Initialize the service empty, then let fresh status-change notifications populate runtime-observed statuses.
  - Subscribe the service to hook-server status changes independently from `agentHookServer.setListener(...)`.
  - Keep the existing window-bound listener for its current renderer `agentStatus:set` fanout and synthetic terminal-title side effects. Those synthesized titles drive sidebar/worktree indicators for agents whose OSC titles do not expose state; do not collapse that path into a pure IPC fanout unless the synthetic-title driver is moved into an equivalent named subscriber with the same cleanup behavior.
  - Register app shutdown cleanup.
- `src/main/ipc/settings.ts`
  - Accept an optional `AgentAwakeService` dependency or a callback.
  - When `keepComputerAwakeWhileAgentsRun` is included in `args`, call `setEnabled(result.keepComputerAwakeWhileAgentsRun)`.
- `src/main/ipc/agent-hooks.ts`
  - `dropStatusEntry(paneKey)` should trigger the hook-server status-change notification, so the service does not need a renderer-tied IPC dependency.
- `src/main/agent-hooks/server.ts`
  - Add a status-change callback list, for example `subscribeStatusChanges(listener): () => void`, so observers do not replace each other.
  - Notify subscribers after each snapshot-changing `lastStatusByPaneKey` set/delete/clear path. This includes local hook ingestion, remote hook ingestion, `dropStatusEntry`, and `clearPaneState`; otherwise PTY teardown or SSH cleanup can remove the cached `working` status without stopping the wake lock until stale expiry.
  - Preserve `setListener(...)` as the renderer fanout API if useful, but do not make the awake service depend on it.

Avoid adding renderer-to-main polling. Status changes are already event-driven.

## Settings UI

Use existing shadcn/settings primitives and documented tokens from `docs/STYLEGUIDE.md` and `src/renderer/src/assets/main.css`.

Recommended UI placement in `AgentsPane`:

- A switch row near agent behavior defaults.
- The toggle should call `updateSettings({ keepComputerAwakeWhileAgentsRun: checked })`.
- No warning modal. The setting is default off and the description explains the power implication.

Search terms:

- `awake`
- `sleep`
- `power`
- `agent`
- `running`

## SSH Behavior

This setting controls only the local computer running Orca.

Remote agents over SSH should count when Orca sees their hook-reported status because the local machine must keep Orca, the SSH connection, and notifications alive. Orca should not attempt to keep the remote host awake. Remote host power policy is outside this feature.

## Tests

Main service unit tests:

- Default disabled with running status does not start blocker.
- Enabled with one `working` status starts one blocker.
- A fresh `working` status with `observedInCurrentRuntime: false` does not start blocker.
- Enabled with only `blocked` or `waiting` statuses does not start blocker.
- Enabled with only `done` statuses stops blocker.
- Transition from one `working` status to another does not start another blocker.
- Start/stop reconciliation uses `isStarted(id)` to keep local blocker id state aligned with Electron.
- A failed stop that leaves `isStarted(id) === true` keeps the id and retries reconciliation on the next refresh/dispose.
- Dropping the last running status stops blocker.
- Stale running status does not start blocker.
- A running status that becomes stale with no further events stops blocker when the internal timer fires.
- A newer running status reschedules the stale-boundary timer.
- `dispose()` clears the stale-boundary timer.
- `dispose()` stops an active blocker once.

Settings tests:

- `getDefaultSettings()` includes `keepComputerAwakeWhileAgentsRun: false`.
- `settings:set` updates the service when the setting changes.

Hook-server integration tests:

- Multiple status-change subscribers can observe the same update without replacing each other.
- Closing the window clears renderer fanout without unsubscribing `AgentAwakeService`.
- Startup hydration initializes the service without making disk-cached statuses wake-eligible.
- Startup-hydrated cached `working` statuses do not start the blocker until the pane emits a fresh hook event in the current runtime.
- `clearPaneState` notifies subscribers after removing a cached `working` status.
- Local PTY teardown and SSH connection cleanup stop the blocker promptly instead of waiting for stale expiry.

Renderer tests:

- Toggle renders in the selected settings pane.
- Toggle writes `keepComputerAwakeWhileAgentsRun`.
- Search finds the setting by `awake` and `sleep`.

Integration smoke:

- Enable the setting.
- Start a local agent and verify the service starts a `prevent-app-suspension` blocker.
- Restart Orca with a persisted cached `working` row and verify the blocker remains stopped until a fresh hook event arrives.
- Mark the agent `done` or drop the row and verify the blocker stops.
- Repeat with an SSH-backed agent status event and verify it counts the same way locally.
- Exercise one blocker API failure path with a mocked `powerSaveBlocker` and verify structured diagnostics include the reason without product telemetry.

## Rollout

No migration is required because the default settings merge hydrates the missing key as `false` for existing users.

No telemetry is required for v1. If adoption data becomes necessary, add the key to the settings-changed whitelist in a separate telemetry review.

## Decisions

- `blocked` and `waiting` do not keep the machine awake. The user asked for the machine to stay awake only while agents are actively working; a blocked/waiting agent should use normal OS sleep behavior until it reports `working` again.
- Should this ever prevent display sleep? Initial answer: no. Users asked to keep work alive, not keep the screen lit.
- Should there be a status-bar indicator while active? Initial answer: no for v1. The setting is optional, and extra chrome is not necessary unless users report confusion.
