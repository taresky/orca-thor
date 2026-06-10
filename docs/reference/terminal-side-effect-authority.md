# Terminal Side-Effect Authority

Status: Phase 3 of the terminal model/view architecture. Builds on
[`terminal-model-view-contract.md`](./terminal-model-view-contract.md) and
[`terminal-hidden-view-parking.md`](./terminal-hidden-view-parking.md) (Phase 1).

## Problem

Main already parses every local/daemon/SSH PTY byte before renderer delivery
(`OrcaRuntimeService.onPtyData`, `src/main/runtime/orca-runtime.ts:3256`:
OSC 9999 agent status, last-OSC-title, headless emulator, tails, URL watchers;
SSH feeds the same path at `src/main/ssh/ssh-relay-session.ts:915`). Yet the
side effects users see — bell unread/notifications, title transitions,
agent-complete notifications, command lifecycle, PR links — are derived a
second time by renderer byte parsers (`pty-transport.ts`'s
`createPtyOutputProcessor`, `pty-connection.ts`, the parked byte watcher).
That duplication forces Phase 1's watcher to exist, forces main to fabricate
synthetic OSC title frames over `pty:data` (`src/main/index.ts:975-990,
1033-1112`) just so renderer parsers can see them, and blocks Phase 4 from
ever stopping hidden byte delivery. Phase 3 makes main the side-effect parser
for every PTY whose bytes transit local main.

## Authority Matrix

"Main" means parsed once in `onPtyData` and delivered as derived facts.
Remote-runtime PTYs (`remote:`) never transit local main; the renderer
(`remote-runtime-pty-transport.ts:74`) stays their parser permanently.

| Side effect | local-daemon | SSH | remote-runtime |
| --- | --- | --- | --- |
| OSC 9999 agent status | main (shipped: `orca-runtime.ts:3259` → `agentStatus:set`) | main (shipped) | renderer (`pty-connection.ts:1490-1541`) |
| OSC 0/1/2 titles + working/idle/exited tracker + 3s stale-title timer | main | main | renderer |
| BEL attention (OSC-aware stateful detector) | main | main | renderer |
| OSC 133;D command-finished exit code | main | main | renderer |
| GitHub PR-link scan | main | main | renderer |
| Command Code output scrape | main (last slice) | main | renderer |
| DECSET 2031 color-scheme reply | renderer view/watcher — query authority stays with the view (contract invariant 6) | same | renderer |
| DECSET 2004 paste readiness (`agent-paste-draft.ts`) | renderer — input pacing, not a model side effect | renderer | renderer |

## Main-Side Tracker

- Lift the side-effect core of `createPtyOutputProcessor`
  (`pty-transport.ts:87-428`) into a shared module
  (`src/shared/terminal-output-side-effects.ts`): all-titles ordering via
  `extractAllOscTitles` (coalesced working→idle transitions are why last-title
  is insufficient — issue #1083), `normalizeTerminalTitle`, the literal
  `cursor agent` title drop (`pty-transport.ts:145-166`), the
  `createAgentStatusTracker` transitions, the stale-working-title 3s timer
  (`pty-transport.ts:51,363-379`), and the stateful BEL detector
  (`bell-detector.ts`).
- One tracker per PTY on `OrcaRuntimeService`, lazily created like
  `agentStatusOscProcessorsByPtyId` (`orca-runtime.ts:3420-3427`); disposed in
  `onPtyExit` (cancels the stale-title timer).
- It replaces `extractLastOscTitle` at `orca-runtime.ts:3286`: titles feed in
  byte order, so `lastOscTitle`/`lastAgentStatus`, tui-idle waiters, and
  pending-message delivery see intermediate transitions instead of only the
  chunk's last title. PTY/leaf records keep the **raw** last title (worktree
  `ps` and mobile tab titles at `orca-runtime.ts:13209` expect raw); emitted
  facts carry `(normalizedTitle, rawTitle)` like `onTitleChange` today.
- No deferred drain in main — the renderer's setTimeout(0) batching
  (`pty-transport.ts:175-182,319-339`) protects xterm paint, which does not
  exist in main. Apply synchronously, batch the IPC per flush.
- The stats `AgentDetector` (`src/main/stats/agent-detector.ts`) keeps its own
  last-title scan, untouched: synthetic titles must never reach it.

## Event Transport: `pty:sideEffect`

One new batched main→renderer channel (preload pattern of `agentStatus:set`,
`src/preload/index.ts:3586`), routed by the existing singleton dispatcher like
`pty:data`/`pty:exit` (`pty-dispatcher.ts:92-145`). Events are **facts, not
decisions**: `title`, `bell`, `agent-working`, `agent-idle` (with title),
`agent-exited`, `command-finished` (exit code), `pr-link`. Each carries
`ptyId`, main-known attribution (worktreeId/tabId/paneKey from runtime leaf
records, same resolution as `emitTerminalAgentStatusEvents`,
`orca-runtime.ts:3429-3460`), and the PTY `outputSequence`.

Ordering rules:

1. Per-PTY in-order; facts from one chunk are emitted in byte order (status
   payloads, then titles in sequence, then bell — the renderer drain's order).
2. Deliberately **not** synchronized with `pty:data`: side effects must keep
   advancing while renderer delivery is ACK-gated (contract invariant 1). A
   completion title may reach the store before the visible xterm paints the
   final output; that is acceptable — attention/title state is out-of-band UI
   state, and today's renderer drain already decouples by many batches under
   timer throttling.
3. No attention replay: facts emitted while no renderer is subscribed are
   dropped. On transport attach/park-handoff the renderer requests (or main
   re-emits) a `title`+status snapshot marked `replay: true` — this reproduces
   the eager-buffer behavior where replay restores titles but is barred from
   bells/completions (`pty-transport.ts:656-714` `suppressAttentionEvents`).
   The store handler ignores a replay title older (by `outputSequence`) than
   the last live title fact it applied.

## Renderer Store Handler (policy stays in the renderer)

Verified current notification semantics, all preserved:

- BEL marks worktree+tab unread unconditionally — including the focused pane
  (`pty-connection.ts:1232-1250`); pane unread only behind
  `experimentalTerminalAttention`; keydown clears unread
  (`pty-connection.ts:959-999`).
- BEL's OS notification is delayed 250 ms and yields to a pending
  agent-task-complete (`pty-connection.ts:1259-1275`).
- working→idle starts the Claude cache timer (null settings = not hydrated,
  treat enabled, `pty-connection.ts:1409-1430`) and schedules completion with
  250 ms grace + 1500 ms max wait + detail-wait store subscription
  (`pty-connection.ts:1328-1390`).
- Completion unread is suppressed only for the exact visible foreground pane
  (`use-notification-dispatch.ts:280-298`); BEL unread has no such check.
- Dispatch-time liveness/staleness guards (`use-notification-dispatch.ts:
  229-277`) and main's 5 s per-worktree cooldown (`src/main/ipc/
  notifications.ts:286-296`) remain the final gates.

These need live renderer store state (PTY/layout maps, pane visibility,
settings, `agentStatusByPaneKey`, repo labels), so they stay in the renderer:
a pane-independent per-paneKey handler module consumes `pty:sideEffect` and
subsumes both `pty-connection.ts`'s callbacks and the parked watcher's
callback block (`parked-terminal-byte-watcher.ts:96-213`) — one policy path
whether the tab is mounted, hidden, or parked. Main holds **no** notification
timers; only the stale-title timer (parser state) moves to main.

## Synthetic Frame Reroute

`driveSyntheticTitleFromHook` and the spinner tick (`src/main/index.ts:
1033-1112`) currently fabricate OSC title/BEL frames onto `pty:data`
(`sendSyntheticTitle`, `index.ts:975-990`) solely for renderer parsers.
Replace with `runtime.ingestSyntheticTitleFrame(ptyId, label, { bell })`
feeding the per-PTY tracker directly — **not** `onPtyData`, so emulator
state, tails, transcripts, and stats stay clean (today they never see these
frames either). Keep the decorative-frame visibility gating
(`shouldSendSyntheticTitleFrame`). Verified renderer dependencies on those
bytes: the visible xterm renders nothing from titles, but
`pane.terminal.onTitleChange` feeds `registerPtyTitleSource`
(`pty-connection.ts:1797-1799`) → renderer serialize-snapshot `lastTitle`
(mobile parity). After the reroute main must prefer its own tracker title
over renderer snapshot `lastTitle`. Side benefit: synthetic frames stop
producing phantom ACKs for bytes main never metered
(`pty-dispatcher.ts:124-129`).

## Migration Switch and Double-Fire Prevention

Authority is structural per PTY kind — the predicate is "bytes transit local
main", exactly the shipped `shouldOwnAgentStatusInRenderer` split
(`pty-connection.ts:1484-1545`). One renderer-consulted kill switch
(`settings.terminalMainSideEffectAuthority`, default on, mirroring
`terminalHiddenViewParking`): when on, IPC transports and the parked watcher
do not register byte parsers for local/SSH and the store handler consumes
`pty:sideEffect`; when off, renderer parsers register and `pty:sideEffect`
events are ignored. Main always parses and emits (its internal consumers need
the tracker regardless); main consults the same setting only to keep the
legacy synthetic-frame `pty:data` path alive while the switch is off. Exactly
one consumer per fact at any time — decided at transport/watcher creation, so
no per-chunk race.

## Sidecar Consumers and Phase 4

Keep renderer byte access (input pacing / raw-output consumers, not side
effects): `agent-paste-draft.ts` (DECSET 2004 readiness),
`launch-agent-background-session.ts` (startup-injection pacing, onData
passthrough), `automation-session-observer.ts` (onData passthrough). Their
duplicated local OSC 9999 store writes drop once main authority covers them.
Phase 4's hidden-delivery gate must exempt PTYs with an active
`subscribeToPtyData` sidecar: that registration becomes an explicit
delivery-interest signal surfaced to main. With main authoritative, the
parked watcher's local/SSH parsing is dead code; since parking eligibility
excludes `remote:` and SSH PTYs, the watcher is deleted outright — it only
returns if remote-runtime tabs ever become parkable.

## Invariants

1. Every byte is side-effect-parsed exactly once, by exactly one authority,
   chosen structurally per PTY kind.
2. Attention facts never replay: snapshot/eager/attach replays restore title
   state only.
3. Notification policy (grace timers, yielding, suppression, dispatch guards)
   lives with the renderer store; main emits facts with ordering metadata.
4. Side-effect facts keep flowing while renderer byte delivery is
   backpressured, parked, or (Phase 4) stopped.
5. Synthetic agent frames feed the model tracker, never the emulator, tails,
   transcripts, or stats.

## Test Strategy

- Parity harness: shared byte fixtures (agent title cycles incl. coalesced
  chunks, BEL inside/spanning OSC, CAN/SUB cancellation, cursor-agent literal,
  stale-title timeout under fake timers, OSC 133;D, split PR URLs) run through
  the renderer `createPtyOutputProcessor` and the main tracker; assert
  identical ordered fact sequences.
- Unit: main tracker tests beside `orca-runtime.test.ts` (lastOscTitle
  parity, tui-idle waiter transitions, synthetic ingestion); store-handler
  tests reusing `parked-terminal-byte-watcher.test.ts` scenarios.
- Pinned tests that flip or retire: `pty-connection.test.ts` callback wiring,
  `parked-terminal-byte-watcher.test.ts` (retires with the watcher);
  `pty-transport*.test.ts` stay (processor remains for remote + kill switch).
- E2E gates that must stay green throughout: `terminal-attention.spec.ts`,
  `droid-notification.spec.ts`, `terminal-hidden-view-parking.spec.ts`,
  `terminal-parked-memory.spec.ts`; add main-authority bell/completion cases
  (parked tab, focused-pane suppression, kill switch off). SSH parity is
  exercised manually per the SSH test procedure before each slice ships.

## Cut-Offs (stacked, independently mergeable)

1. **Shared tracker in main.** Extract the processor core to shared, run the
   per-PTY tracker in `onPtyData` replacing `extractLastOscTitle`, parity
   tests. Main-internal consumers only; no IPC or renderer change.
2. **Authority flip.** `pty:sideEffect` channel, renderer store handler,
   titles/bell/tracker authority to main for local+SSH behind the kill
   switch; parked watcher stops byte parsing for those kinds.
3. **Inversion unwind.** Synthetic frames into the tracker, off `pty:data`;
   OSC 133;D and PR-link facts; mobile `lastTitle` source preference.
4. **Long tail.** Command Code scrape to main, sidecar OSC 9999 dedup, parked
   watcher deletion, Phase 4 delivery-interest registration documented in the
   gate design.
