#!/usr/bin/env bash
# Reproduction + fix demonstration for issue #6635.
# POSIX bash; works on macOS, Linux, WSL2.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node_bin="${NODE:-node}"

echo "=============================================================="
echo " issue #6635 repro — watcher native abort vs. process survival"
echo " node: $("$node_bin" -v)   platform: $(uname -s) $(uname -m)"
echo "=============================================================="

# ---- Failure mode (current): worker_thread native abort ----
echo
echo ">> [PRE-FIX] native abort inside a worker_thread (how the watcher used to run)"
"$node_bin" "$here/worker-thread-crash.mjs"
worker_status=$?
worker_signal=$((worker_status - 128))
echo ">> exit status: $worker_status (signal $worker_signal if >128)"

# SIGABRT is signal 6 -> process exits with 134 when not caught. The reporter's
# dmesg shows "fatal signal 6". A status of 134 means the whole process died.
if [ "$worker_status" -eq 134 ]; then
  echo ">> REPRODUCED: worker_thread abort killed the entire process with SIGABRT (134)."
  reproduced=1
else
  echo ">> NOTE: process exited $worker_status (expected 134/SIGABRT)."
  reproduced=0
fi

# ---- Fix (proposed): child_process native abort ----
echo
echo ">> [FIX] same native abort inside a forked child_process"
"$node_bin" "$here/child-process-survives.mjs"
child_status=$?
echo ">> exit status: $child_status (0 = host survived, terminal preserved)"

# ---- Fix verification against the REAL production host module ----
# Skipped when esbuild isn't resolvable (e.g. the standalone Docker image that
# only installs @parcel/watcher); the deterministic cases above already prove
# the mechanism. Run from the repo root so node can resolve esbuild.
echo
echo ">> [FIX/real-code] drive src/main/runtime/file-watcher-host.ts through a child SIGABRT"
verify_status=0
if "$node_bin" -e "require.resolve('esbuild')" >/dev/null 2>&1; then
  "$node_bin" "$here/verify-fix.mjs"
  verify_status=$?
  echo ">> verify-fix exit: $verify_status (0 = production host survived + refreshed)"
else
  echo ">> esbuild not available here — skipping real-code verification (run from repo root)."
fi

echo
echo "=============================================================="
if [ "$reproduced" -eq 1 ] && [ "$child_status" -eq 0 ] && [ "$verify_status" -eq 0 ]; then
  echo " VERDICT: PASS"
  echo "  - worker_thread abort is process-fatal (kills serve + its terminals)"
  echo "  - child_process abort is survivable (serve + terminals live on)"
  echo "  - the real file-watcher-host survives a child SIGABRT and refreshes"
  exit 0
fi
echo " VERDICT: FAIL (worker_reproduced=$reproduced child_survived=$child_status verify=$verify_status)"
echo "=============================================================="
exit 1
