import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

import { installLinuxBareOrcaDispatcher } from './linux-bare-orca-dispatcher'

const created: string[] = []

async function makeFixture(): Promise<{ homePath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-bare-dispatcher-'))
  created.push(root)
  return { homePath: join(root, 'home'), resourcesPath: join(root, 'resources') }
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('installLinuxBareOrcaDispatcher', () => {
  it('writes an executable bare-orca dispatcher that execs the bundled orca-ide launcher', async () => {
    const { homePath, resourcesPath } = await makeFixture()

    const result = await installLinuxBareOrcaDispatcher({ resourcesPath, homePath })

    const expectedTarget = join(resourcesPath, 'bin', 'orca-ide')
    expect(result.target).toBe(expectedTarget)
    expect(result.dispatcherPath).toBe(join(homePath, '.local', 'bin', 'orca'))

    const content = await readFile(result.dispatcherPath, 'utf8')
    expect(content).toBe(`#!/usr/bin/env bash\nexec ${JSON.stringify(expectedTarget)} "$@"\n`)

    const mode = (await stat(result.dispatcherPath)).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  it('is idempotent — a second install rewrites the same dispatcher without throwing', async () => {
    const { homePath, resourcesPath } = await makeFixture()

    const first = await installLinuxBareOrcaDispatcher({ resourcesPath, homePath })
    const second = await installLinuxBareOrcaDispatcher({ resourcesPath, homePath })

    expect(second).toEqual(first)
    await expect(readFile(second.dispatcherPath, 'utf8')).resolves.toContain('exec')
  })

  it('quotes a resources path containing spaces so the exec line cannot be split', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-bare-dispatcher-space-'))
    created.push(root)
    const resourcesPath = join(root, 'App Support', 'resources')

    const result = await installLinuxBareOrcaDispatcher({
      resourcesPath,
      homePath: join(root, 'home')
    })

    const content = await readFile(result.dispatcherPath, 'utf8')
    // JSON.stringify wraps the spaced path in double quotes as one exec argument.
    expect(content).toContain(`exec "${join(resourcesPath, 'bin', 'orca-ide')}" "$@"`)
  })
})
