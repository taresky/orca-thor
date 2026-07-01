'use strict'
// Models @parcel/watcher's native crash: a C++ `Napi::Error` thrown during
// worker teardown is turned into `std::terminate()` -> `abort()` -> SIGABRT
// (signal 6) by the C runtime. `process.abort()` raises the identical signal,
// so downstream behavior (who dies, what's catchable) is faithful. The real
// crash is a non-deterministic use-after-free during `FreeEnvironment`; the
// deterministic part we care about is the SIGABRT it produces.
//
// We give any JS-level guard a chance to (fail to) intercept it: there is no
// way to catch a native abort from JS, which is the whole point.
//
// We raise SIGABRT (signal 6) at the OS level via process.kill rather than
// process.abort(): worker_threads explicitly reject process.abort() and convert
// it into a catchable JS error, which is NOT how a native C++ abort behaves.
// Sending the real signal reproduces the uncatchable, process-wide SIGABRT that
// @parcel/watcher's native terminate() produces (dmesg "fatal signal 6").
setTimeout(() => {
  process.kill(process.pid, 'SIGABRT')
}, 50)
