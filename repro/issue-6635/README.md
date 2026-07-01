# Reproduction harness — issue #6635

> Headless `orca serve` SIGABRT — uncaught `Napi::Error` (empty `what()`) tears
> down all agent terminals [Linux/WSL2, 1.4.97]

## What the issue actually is

Two independent failure modes compound into the reported symptom:

1. **The crash is process-fatal and uncatchable (root cause).**
   `@parcel/watcher`'s native code raises a C++ `Napi::Error` during worker
   teardown (`FreeEnvironment` / `CleanupHandles`). Today the watcher runs in a
   **Node `worker_thread`** (`src/main/runtime/file-watcher-worker.ts`). A native
   `abort()` / `std::terminate()` raised on a worker thread is **not** delivered
   to the host as a catchable `worker.on('error')` event, and **not** catchable
   by `process.on('uncaughtException')` — it raises `SIGABRT` (signal 6) for the
   **entire process**. So no JS handler anywhere can save the `serve` process.

   > journald: `terminate called after throwing an instance of 'Napi::Error'`
   > dmesg: `potentially unexpected fatal signal 6` / `ORIG_RAX: 0xea` (tgkill).

2. **Headless `serve` runs agent terminals in-process (resilience gap).**
   Desktop routes PTYs through a **detached daemon** process
   (`fork(..., { detached: true })`, then `unref()`), so a main-process crash
   leaves terminals alive. Headless `orca serve` instead registers PTYs
   **in-process** via `LocalPtyProvider` (`registerHeadlessPtyRuntime` →
   `registerPtyHandlers`). So when the `serve` process takes `SIGABRT`, every
   agent terminal child it owns dies with it.

The harness reproduces both, and proves the fix for both.

## Files

- `native-abort.js` — emits a real `SIGABRT` (signal 6) the same way a native
  `Napi::Error` → `terminate()` does. Used to model the watcher crash
  deterministically (the real watcher crash is a non-deterministic
  use-after-free race during teardown; the *consequence* — SIGABRT — is what we
  reproduce).
- `worker-thread-crash.mjs` — runs `native-abort.js` inside a `worker_thread`
  with every JS guard installed (`worker.on('error')`, `process.on(
  'uncaughtException')`). **Reproduces failure mode #1**: the whole process dies
  with signal 6 anyway, and a simulated "agent terminal" child the process owned
  is reaped.
- `child-process-survives.mjs` — runs the *same* `native-abort.js` inside a
  forked **child process**. **Demonstrates the prong-A fix**: the parent catches
  the child's `SIGABRT` as an `exit` event, stays alive, and the simulated agent
  terminal keeps running.
- `verify-fix.mjs` — **fix verification against the real production code**.
  Compiles `src/main/runtime/file-watcher-host.ts` (electron stubbed), points it
  at a child entry that raises a real `SIGABRT` mid-watch, and asserts the host
  process survives and emits an `overflow` refresh. Before the fix this same
  abort (in a worker_thread) killed the host with status 134.
- `run.sh` — runs the cases above plus the real-code verification and prints a
  PASS/FAIL verdict. (The real-code step needs `esbuild` from the repo root; it
  is skipped in the minimal Docker image.)
- `Dockerfile` — runs the harness on `node:24-bookworm` (glibc Linux) to mirror
  the reporter's Ubuntu/WSL2 environment, including the real `@parcel/watcher`
  Linux native module.

## Run locally

```sh
bash repro/issue-6635/run.sh
```

## Run on Linux (mirror the reporter's env)

```sh
docker build -f repro/issue-6635/Dockerfile -t orca-6635-repro repro/issue-6635
docker run --rm orca-6635-repro
```

### Observed output (Linux glibc, Docker)

```
>> [CURRENT] native abort inside a worker_thread (file-watcher-worker.ts)
run.sh: line 17:    14 Aborted                 ...
>> exit status: 134 (signal 6 if >128)
>> REPRODUCED: worker_thread abort killed the entire process with SIGABRT (134).

>> [FIX] same native abort inside a forked child_process
[host] child exited code=null signal=SIGABRT — host still alive
[host] SURVIVED the child native abort, agent terminal still alive — PASS
```

`Aborted` + status **134** == SIGABRT (signal 6), matching the reporter's dmesg
`potentially unexpected fatal signal 6`.

### Note on `worker-real-watcher.mjs`

The extra probe loads the *real* `@parcel/watcher` native addon inside a worker
thread. On recent `@parcel/watcher` it surfaces `Module did not self-register`
when re-loaded across worker threads — itself evidence of the addon's
worker-thread lifecycle fragility. The deterministic SIGABRT repro above is the
load-bearing demonstration; the real-module churn is a best-effort stress probe
(the underlying abort is a non-deterministic use-after-free during teardown).
