# Mirror the reporter's environment: glibc Linux x64 (Ubuntu 24.04 / WSL2).
# Node 24 matches the Electron-bundled Node major used by Orca's runtime closely
# enough to reproduce worker_threads SIGABRT semantics, which are libuv/V8-level
# and stable across recent majors.
FROM node:24-bookworm

WORKDIR /repro

# Install the real @parcel/watcher so worker-real-watcher.mjs can exercise the
# actual native module on Linux (the prime suspect from #5377/#4851).
RUN npm init -y >/dev/null 2>&1 && npm install @parcel/watcher@^2.5.6 >/dev/null 2>&1

COPY native-abort.js worker-thread-crash.mjs child-process-survives.mjs run.sh ./
COPY worker-real-watcher.mjs ./

# Make node resolvable as `node` for run.sh and ensure execute bit on the script.
RUN chmod +x run.sh

# Default: run the deterministic SIGABRT repro + fix demonstration, then exercise
# the real @parcel/watcher subscribe/teardown loop on Linux for good measure.
CMD bash run.sh && \
    echo && echo ">> [EXTRA] real @parcel/watcher subscribe/unsubscribe churn on Linux" && \
    node worker-real-watcher.mjs
