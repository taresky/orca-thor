# Mobile Dictation Keep-Awake Perf Audit

Task: `task_6cc0dd2ad31c`

## Scope Reviewed

- Required perf skill: `/Users/jinjingliang/Documents/projects/noqa/devex/.orca-internal/eng/skills/perf/SKILL.md`
- Design doc: `docs/mobile-dictation-keep-awake.md`
- Changed tracked files: `mobile/package.json`, `mobile/pnpm-lock.yaml`, `mobile/src/hooks/use-mobile-dictation.ts`, `mobile/src/hooks/use-mobile-dictation-source.test.ts`
- New untracked implementation files: `mobile/src/hooks/mobile-dictation-keep-awake.ts`, `mobile/src/hooks/mobile-dictation-session-state.ts`, `mobile/src/hooks/mobile-dictation-desktop-start.ts`, `mobile/src/hooks/mobile-dictation-audio-chunk.ts`

## Performance Surfaces Checked

- Polling/timers/startup: no added `setInterval`, `setTimeout`, startup probe, watcher, or background loop in the touched runtime files.
- RPC volume: steady-state audio chunking remains one `speech.dictation.chunk` request per accepted microphone event; keep-awake adds no per-chunk RPC. New/relocated `speech.dictation.cancel` calls are stale/error cleanup only.
- Render/store work: `useMobileDictation` adds one `useMemo` owner per hook instance and no broad store subscription or render-time scan.
- Mobile native handles: `expo-keep-awake` is acquired once per successful desktop dictation start and released on stop, cancel, failure, disabled-state cancel, audio interruption cancel, and unmount.
- Async cleanup ordering: recording shutdown calls `toggleRecording(false)` before best-effort keep-awake release, so release latency should not extend microphone capture.
- Memory/resource leaks: owner tags are per hook owner plus dictation id; acquire/release operations are serialized so stale release should not deactivate a newer session tag.
- Cache/invalidation: no cache, persisted state, or cross-device sync was added; keep-awake remains local mobile state.
- Subprocess/filesystem: dependency metadata changed only; no runtime subprocess or filesystem work was added.

## Findings

Severity: None for Critical, High, and Medium.

I did not find a concrete Critical/High/Medium performance issue in the implemented diff. The change follows the intended shape from the design doc: no polling, no recurring native work, no added startup path, no extra chunk-path RPCs, and release is not awaited before recording shutdown.

Low: None.

Nit: None.

## Measurement Or Test Hooks For Residual Risks

- Native keep-awake handle cleanup: deterministic native/mock test that runs start -> stop, start -> cancel, start -> disable, start -> interruption, and start -> unmount loops while counting `activateKeepAwakeAsync` and `deactivateKeepAwake` calls by tag; expected count is one release for each acquired tag and no release of a later tag by an earlier operation.
- Stale acquire/release race: unit test with mocked keep-awake promises where acquire is delayed, cancel/unmount runs, then acquire resolves; expected result is the stale tag is released and `toggleRecording(true)` is never called.
- RPC volume: mocked `client.sendRequest` method-name counter over one dictation session with N microphone events; expected count is one start, N chunks, one finish or cancel, and zero keep-awake-related RPCs.
- Shutdown latency: deterministic ordering test or trace asserting `toggleRecording(false)` is invoked before `keepAwakeOwner.release(...)`, `Promise.allSettled(...)`, and `speech.dictation.finish`.
- Memory/resource retention: repeated hook mount/start/cancel/unmount test with mocked event listeners and keep-awake owner; expected listener count returns to baseline and pending chunk/budget state is cleared.

## Checks Run Or Inspected

- Inspected `git status --short`.
- Inspected `git diff` for tracked changed files.
- Read all required new untracked files directly.
- Searched touched runtime files for timers/listeners/native keep-awake calls/RPC calls with `rg`.
- Ran `pnpm --dir mobile test -- src/hooks/use-mobile-dictation-source.test.ts`.

## Test Result

`pnpm --dir mobile test -- src/hooks/use-mobile-dictation-source.test.ts` passed: 173 test files, 1258 tests passed, 2 skipped.

No implementation files were changed by this audit.
