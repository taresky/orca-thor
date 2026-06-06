import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const vitePackageJson = require.resolve('vite/package.json')
const viteCli = path.join(path.dirname(vitePackageJson), 'bin', 'vite.js')
const requestedNodeOptions = '--max-old-space-size=4096'
const existingNodeOptions = process.env.NODE_OPTIONS?.trim()

// Why: Raspberry Pi and release runners can hit Node's default old-space
// ceiling while bundling the large web renderer chunks.
const nodeOptions = existingNodeOptions
  ? `${existingNodeOptions} ${requestedNodeOptions}`
  : requestedNodeOptions

const child = spawn(
  process.execPath,
  [viteCli, 'build', '--config', 'vite.web.config.ts', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions
    }
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
