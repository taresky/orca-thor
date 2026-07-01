// End-to-end verification that the PRODUCTION host module
// (src/main/runtime/file-watcher-host.ts) survives a native watcher abort.
//
// We compile the real host with esbuild (stubbing `electron` so we don't need a
// full Electron runtime), point it at a faulting child entry that raises a real
// SIGABRT after going `ready`, and assert:
//   1. the host process stays alive (does NOT die with signal 6), and
//   2. the live-crash surfaces as an `overflow` refresh to the callback.
//
// This drives the actual fork(), the {type:'ready'} handshake, and the new
// child `exit(signal)` -> overflow path added for #6635.
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const here = import.meta.dirname
const repoRoot = resolve(here, '..', '..')
const out = mkdtempSync(join(tmpdir(), 'orca-6635-verify-'))

// Stub electron so the host's `import { app } from 'electron'` resolves to a
// non-packaged app in this plain-Node harness.
const electronStub = join(out, 'electron-stub.js')
writeFileSync(electronStub, 'export const app = { isPackaged: false }\n')

// A child entry that mimics file-watcher-process: report ready (the watch goes
// live), then spontaneously raise a REAL native-style SIGABRT mid-operation —
// the exact failure that used to kill the whole serve process and all its
// in-process agent terminals.
const childEntry = join(out, 'file-watcher-process.js')
writeFileSync(
  childEntry,
  [
    "process.send({ type: 'ready' });",
    '// Simulate @parcel/watcher native abort while the watch is live.',
    "setTimeout(() => process.kill(process.pid, 'SIGABRT'), 100);"
  ].join('\n')
)

// Build as CommonJS to match electron-vite's main-process output (where the
// host's __dirname-based child path resolution is valid).
await build({
  entryPoints: [join(repoRoot, 'src/main/runtime/file-watcher-host.ts')],
  outfile: join(out, 'file-watcher-host.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  alias: { electron: electronStub },
  logLevel: 'silent'
})

const { createRequire } = await import('node:module')
const requireFromHarness = createRequire(import.meta.url)
const host = requireFromHarness(join(out, 'file-watcher-host.cjs'))

let sawOverflow = false
await host.watchFileExplorerInWorker(repoRoot, (events) => {
  if (events.some((e) => e.kind === 'overflow')) {
    sawOverflow = true
  }
})
console.log('[verify] watch is live (child reported ready); child will abort in ~100ms')

setTimeout(() => {
  // If we reached here, the host SURVIVED the child's mid-operation SIGABRT.
  if (sawOverflow) {
    console.log('[verify] host SURVIVED the child SIGABRT and emitted an overflow refresh — PASS')
    process.exit(0)
  }
  console.log('[verify] host survived but did not emit the expected overflow refresh — FAIL')
  process.exit(1)
}, 1200)
