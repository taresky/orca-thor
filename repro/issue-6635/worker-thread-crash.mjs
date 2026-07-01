// Failure mode #1 + #2 (the PRE-FIX architecture this issue is about).
//
// Before the fix, the file watcher ran in a worker_thread. This models what
// happens when that worker hits a native abort: the host installs every JS
// guard it can, AND owns a long-lived child (a stand-in for an agent terminal
// PTY, which headless `serve` kept in-process). We expect: the guards do NOT
// save the process, the whole process dies with SIGABRT, and the child terminal
// is torn down with it. (The fix moves the watcher to a child process — see
// child-process-survives.mjs and verify-fix.mjs.)
import { Worker } from 'node:worker_threads'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const here = import.meta.dirname

// Stand-in for an in-process agent terminal: a child that prints a heartbeat.
// Because headless `serve` owns its PTYs in-process, this child is reaped when
// its parent dies (it would be re-parented to init only if it outlived us).
const terminal = spawn(
  process.execPath,
  ['-e', "setInterval(() => process.stdout.write('agent-terminal: alive\\n'), 30)"],
  { stdio: 'inherit' }
)

// Every JS guard the host could install. None can catch a native abort.
process.on('uncaughtException', (err) => {
  console.log('[host] uncaughtException handler fired (should NOT happen):', err?.message)
})
process.on('unhandledRejection', (reason) => {
  console.log('[host] unhandledRejection handler fired (should NOT happen):', reason)
})

const worker = new Worker(join(here, 'native-abort.js'))
worker.on('error', (err) => {
  // For a native abort this never fires — the process is already gone.
  console.log('[host] worker.on(error) fired (should NOT happen):', err?.message)
})
worker.on('exit', (code) => {
  console.log('[host] worker.on(exit) fired (should NOT happen) code=', code)
})

// If we somehow survive, report it (the test treats survival here as a FAIL).
setTimeout(() => {
  console.log('[host] SURVIVED the worker native abort — unexpected for a worker_thread')
  terminal.kill('SIGKILL')
  process.exit(0)
}, 1500)
