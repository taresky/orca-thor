// Prong-A fix demonstration (PROPOSED architecture).
//
// Run the SAME native abort in a forked CHILD PROCESS instead of a
// worker_thread. A child process abort is isolated: the parent observes it as
// an `exit` event with signal 'SIGABRT' and stays alive. The in-process agent
// terminal keeps running.
import { fork, spawn } from 'node:child_process'
import { join } from 'node:path'

const here = import.meta.dirname

const terminal = spawn(
  process.execPath,
  ['-e', "setInterval(() => process.stdout.write('agent-terminal: alive\\n'), 30)"],
  { stdio: 'inherit' }
)

let parentSurvivedAfterCrash = false

const child = fork(join(here, 'native-abort.js'), [], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc']
})

child.on('error', (err) => {
  console.log('[host] child.on(error):', err?.message)
})
child.on('exit', (code, signal) => {
  // This is the key: the crash surfaces here, catchably, instead of killing us.
  console.log(`[host] child exited code=${code} signal=${signal} — host still alive`)
  if (signal === 'SIGABRT' || code !== 0) {
    parentSurvivedAfterCrash = true
  }
})

setTimeout(() => {
  if (parentSurvivedAfterCrash) {
    console.log('[host] SURVIVED the child native abort, agent terminal still alive — PASS')
    terminal.kill('SIGKILL')
    process.exit(0)
  }
  console.log('[host] did not observe the expected child crash — FAIL')
  terminal.kill('SIGKILL')
  process.exit(1)
}, 1500)
