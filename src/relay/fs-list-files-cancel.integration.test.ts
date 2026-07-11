/**
 * End-to-end in-process regression tests for #7721: cancellable fs.listFiles.
 *
 * Wires the client-side SshChannelMultiplexer to the relay-side
 * RelayDispatcher + FsHandler through an in-memory pipe (no SSH). The scan
 * body is a controllable fake so the tests are deterministic:
 *   - aborting the client request sends rpc.cancel and stops the relay scan,
 *   - interactive fs.readDir is served while a scan is in flight,
 *   - a scan for a different workspace supersedes the previous one,
 *   - identical concurrent requests coalesce into one scan.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'

const { fakeListFiles } = vi.hoisted(() => {
  type ScanRecord = {
    rootPath: string
    signal: AbortSignal | undefined
    resolve: (files: string[]) => void
  }
  const scans: ScanRecord[] = []
  const fakeListFiles = Object.assign(
    vi.fn(
      (
        rootPath: string,
        _excludes: readonly string[] = [],
        options: { signal?: AbortSignal } = {}
      ) =>
        new Promise<string[]>((resolve, reject) => {
          scans.push({ rootPath, signal: options.signal, resolve })
          options.signal?.addEventListener(
            'abort',
            () =>
              // Mirror the real scanners: surface the abort reason (e.g. the
              // "superseded" error) so the dispatcher reports it to the host.
              reject(
                options.signal?.reason instanceof Error
                  ? options.signal.reason
                  : new Error('File listing cancelled')
              ),
            { once: true }
          )
        })
    ),
    { scans }
  )
  return { fakeListFiles }
})

vi.mock('./fs-handler-utils', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    checkRgAvailable: () => Promise.resolve(true),
    listFilesWithRg: fakeListFiles
  }
})

import {
  SshChannelMultiplexer,
  type MultiplexerTransport
} from '../main/ssh/ssh-channel-multiplexer'
import { RelayDispatcher } from './dispatcher'
import { RelayContext } from './context'
import { FsHandler } from './fs-handler'

async function flushPipe(): Promise<void> {
  // The in-memory pipe defers each hop with setImmediate; a few macrotask
  // turns guarantee request/notification frames have crossed both directions.
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('Integration: cancellable fs.listFiles (#7721)', () => {
  let tmpDir: string
  let mux: SshChannelMultiplexer
  let dispatcher: RelayDispatcher
  let fsHandler: FsHandler

  beforeEach(() => {
    fakeListFiles.mockClear()
    fakeListFiles.scans.length = 0
    tmpDir = mkdtempSync(path.join(tmpdir(), 'relay-listfiles-cancel-'))

    let relayFeedFn: (data: Buffer) => void
    const clientDataCallbacks: ((data: Buffer) => void)[] = []
    const clientTransport: MultiplexerTransport = {
      write: (data: Buffer) => {
        setImmediate(() => relayFeedFn?.(data))
      },
      onData: (cb) => {
        clientDataCallbacks.push(cb)
      },
      onClose: () => {}
    }
    dispatcher = new RelayDispatcher((data: Buffer) => {
      setImmediate(() => {
        for (const cb of clientDataCallbacks) {
          cb(data)
        }
      })
    })
    relayFeedFn = (data: Buffer) => dispatcher.feed(data)
    fsHandler = new FsHandler(dispatcher, new RelayContext())
    mux = new SshChannelMultiplexer(clientTransport)
  })

  afterEach(async () => {
    mux.dispose()
    dispatcher.dispose()
    fsHandler.dispose()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('serves fs.readDir while a full-tree scan is in flight', async () => {
    writeFileSync(path.join(tmpDir, 'a.txt'), 'a')

    const scanPromise = mux.request('fs.listFiles', { rootPath: '/big/workspace' })
    await flushPipe()
    expect(fakeListFiles.scans).toHaveLength(1)

    // The interactive request must complete while the scan is still pending.
    const entries = (await mux.request('fs.readDir', { dirPath: tmpDir })) as { name: string }[]
    expect(entries.map((e) => e.name)).toEqual(['a.txt'])

    fakeListFiles.scans[0].resolve(['src/index.ts'])
    await expect(scanPromise).resolves.toEqual(['src/index.ts'])
  })

  it('client abort sends rpc.cancel and stops the relay-side scan', async () => {
    const controller = new AbortController()
    const scanPromise = mux.request(
      'fs.listFiles',
      { rootPath: '/big/workspace' },
      { signal: controller.signal }
    )
    await flushPipe()
    expect(fakeListFiles.scans).toHaveLength(1)
    expect(fakeListFiles.scans[0].signal?.aborted).toBe(false)

    controller.abort()
    await expect(scanPromise).rejects.toThrow('was cancelled')
    await flushPipe()

    // The rpc.cancel notification must have aborted the scan on the relay.
    expect(fakeListFiles.scans[0].signal?.aborted).toBe(true)
  })

  // Why #7769: two independent callers on one SSH connection (one relay
  // clientId) — e.g. the editor's markdown-document scan (no excludePaths) and
  // Quick Open (nested-worktree excludePaths) — carry different scan keys.
  // Neither may supersede the other: the earlier one must complete and return
  // its own result, not fail with a "superseded" error nobody triggered.
  it('runs two concurrent unrelated listings without superseding either', async () => {
    const markdown = mux.request('fs.listFiles', { rootPath: '/workspace/a' })
    await flushPipe()
    expect(fakeListFiles.scans).toHaveLength(1)

    const quickOpen = mux.request('fs.listFiles', {
      rootPath: '/workspace/a',
      excludePaths: ['/workspace/a/worktrees/feature']
    })
    await flushPipe()
    expect(fakeListFiles.scans).toHaveLength(2)

    // The first scan is not aborted by the second — both stay live.
    expect(fakeListFiles.scans[0].signal?.aborted).toBe(false)
    expect(fakeListFiles.scans[1].signal?.aborted).toBe(false)

    fakeListFiles.scans[0].resolve(['README.md'])
    fakeListFiles.scans[1].resolve(['src/index.ts'])
    await expect(markdown).resolves.toEqual(['README.md'])
    await expect(quickOpen).resolves.toEqual(['src/index.ts'])
  })

  it('identical concurrent requests coalesce into a single scan', async () => {
    const first = mux.request('fs.listFiles', { rootPath: '/workspace/a' })
    const second = mux.request('fs.listFiles', { rootPath: '/workspace/a' })
    await flushPipe()

    expect(fakeListFiles.scans).toHaveLength(1)
    fakeListFiles.scans[0].resolve(['shared.ts'])
    await expect(first).resolves.toEqual(['shared.ts'])
    await expect(second).resolves.toEqual(['shared.ts'])
  })

  it('cancelling one coalesced requester keeps the scan alive for the other', async () => {
    const controller = new AbortController()
    const first = mux.request(
      'fs.listFiles',
      { rootPath: '/workspace/a' },
      { signal: controller.signal }
    )
    const second = mux.request('fs.listFiles', { rootPath: '/workspace/a' })
    await flushPipe()
    expect(fakeListFiles.scans).toHaveLength(1)

    controller.abort()
    await expect(first).rejects.toThrow('was cancelled')
    await flushPipe()
    expect(fakeListFiles.scans[0].signal?.aborted).toBe(false)

    fakeListFiles.scans[0].resolve(['still.ts'])
    await expect(second).resolves.toEqual(['still.ts'])
  })
})
