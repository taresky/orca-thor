import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsChangeEvent } from '../../shared/types'

type MockChild = {
  killed: boolean
  killSignal: string | undefined
  sentMessages: unknown[]
  forkEnv: NodeJS.ProcessEnv | undefined
  on(event: string, listener: (...args: unknown[]) => void): MockChild
  once(event: string, listener: (...args: unknown[]) => void): MockChild
  off(event: string, listener: (...args: unknown[]) => void): MockChild
  send(message: unknown): boolean
  kill(signal?: string): boolean
  emit(event: string, ...args: unknown[]): void
  listenerCount(event: string): number
}

const childState = vi.hoisted(() => {
  const instances: MockChild[] = []
  class MockChildImpl {
    killed = false
    killSignal: string | undefined
    sentMessages: unknown[] = []
    forkEnv: NodeJS.ProcessEnv | undefined
    private listeners = new Map<string, { listener: (...args: unknown[]) => void; once: boolean }[]>()

    constructor(env: NodeJS.ProcessEnv | undefined) {
      this.forkEnv = env
      instances.push(this as unknown as MockChild)
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? []
      list.push({ listener, once: false })
      this.listeners.set(event, list)
      return this
    }

    once(event: string, listener: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? []
      list.push({ listener, once: true })
      this.listeners.set(event, list)
      return this
    }

    off(event: string, listener: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? []
      this.listeners.set(
        event,
        list.filter((entry) => entry.listener !== listener)
      )
      return this
    }

    send(message: unknown): boolean {
      this.sentMessages.push(message)
      return true
    }

    kill(signal?: string): boolean {
      this.killed = true
      this.killSignal = signal
      return true
    }

    emit(event: string, ...args: unknown[]): void {
      const entries = this.listeners.get(event)?.slice() ?? []
      for (const entry of entries) {
        if (entry.once) {
          this.off(event, entry.listener)
        }
        entry.listener(...args)
      }
    }

    listenerCount(event: string): number {
      return this.listeners.get(event)?.length ?? 0
    }
  }
  return { instances, MockChildImpl }
})

vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

vi.mock('child_process', () => ({
  fork: (_path: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) =>
    new childState.MockChildImpl(options?.env)
}))

import { watchFileExplorerInWorker } from './file-watcher-host'

function lastChild(): MockChild {
  const child = childState.instances.at(-1)
  if (!child) {
    throw new Error('no child forked')
  }
  return child
}

describe('watchFileExplorerInWorker', () => {
  beforeEach(() => {
    childState.instances.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves to an unsubscribe fn once the child reports ready', async () => {
    const promise = watchFileExplorerInWorker('/repo', vi.fn())
    const child = lastChild()
    // The watch target rides env so paths with spaces/quotes survive the fork.
    expect(child.forkEnv?.ORCA_FILE_WATCH_ROOT).toBe('/repo')
    expect(child.forkEnv?.ELECTRON_RUN_AS_NODE).toBe('1')

    child.emit('message', { type: 'ready' })
    const dispose = await promise
    expect(typeof dispose).toBe('function')
  })

  it('forwards child events to the callback only after ready', async () => {
    const onEvents = vi.fn<(events: FsChangeEvent[]) => void>()
    const promise = watchFileExplorerInWorker('/repo', onEvents)
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    await promise

    const events: FsChangeEvent[] = [
      { kind: 'update', absolutePath: '/repo/a.txt', isDirectory: false }
    ]
    child.emit('message', { type: 'events', events })
    expect(onEvents).toHaveBeenCalledWith(events)
  })

  it('rejects if the child errors before the crawl goes live', async () => {
    const promise = watchFileExplorerInWorker('/repo', vi.fn())
    const child = lastChild()
    child.emit('message', { type: 'error', message: 'addon missing' })

    await expect(promise).rejects.toThrow('addon missing')
    expect(child.killed).toBe(true)
  })

  it('rejects if the child exits before ready', async () => {
    const promise = watchFileExplorerInWorker('/repo', vi.fn())
    const child = lastChild()
    child.emit('exit', 1, null)

    await expect(promise).rejects.toThrow(/exited before ready/)
  })

  it('emits an overflow if a live child errors', async () => {
    const onEvents = vi.fn<(events: FsChangeEvent[]) => void>()
    const promise = watchFileExplorerInWorker('/repo', onEvents)
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    await promise

    child.emit('error', new Error('boom'))
    expect(onEvents).toHaveBeenCalledWith([{ kind: 'overflow', absolutePath: '/repo' }])
  })

  it('emits exactly one overflow when a live crash surfaces as error then exit', async () => {
    const onEvents = vi.fn<(events: FsChangeEvent[]) => void>()
    const promise = watchFileExplorerInWorker('/repo', onEvents)
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    await promise

    child.emit('error', new Error('boom'))
    child.emit('exit', null, 'SIGABRT')
    const overflowCalls = onEvents.mock.calls.filter((c) =>
      (c[0] as FsChangeEvent[]).some((e) => e.kind === 'overflow')
    )
    expect(overflowCalls).toHaveLength(1)
  })

  it('kills a live-but-pre-ready child that errors, to avoid orphaning the watcher', async () => {
    const promise = watchFileExplorerInWorker('/repo', vi.fn())
    const child = lastChild()
    child.emit('error', new Error('spawn-ish failure'))
    await expect(promise).rejects.toThrow('spawn-ish failure')
    expect(child.killed).toBe(true)
  })

  it('survives a native watcher abort: a SIGABRT child exit becomes an overflow, not a crash', async () => {
    // This is the #6635 fix: in a child process a native @parcel/watcher
    // teardown abort surfaces here as a `signal` exit instead of taking down
    // the whole serve process. The host must stay alive and just refresh.
    const onEvents = vi.fn<(events: FsChangeEvent[]) => void>()
    const promise = watchFileExplorerInWorker('/repo', onEvents)
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    await promise

    child.emit('exit', null, 'SIGABRT')
    expect(onEvents).toHaveBeenCalledWith([{ kind: 'overflow', absolutePath: '/repo' }])
  })

  it('does not emit an overflow on a clean live-child exit', async () => {
    const onEvents = vi.fn<(events: FsChangeEvent[]) => void>()
    const promise = watchFileExplorerInWorker('/repo', onEvents)
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    await promise
    onEvents.mockClear()

    child.emit('exit', 0, null)
    expect(onEvents).not.toHaveBeenCalled()
  })

  it('unsubscribes and waits for a clean child exit without force-killing', async () => {
    const promise = watchFileExplorerInWorker('/repo', vi.fn())
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    const dispose = await promise

    const disposed = dispose()
    expect(child.sentMessages).toContainEqual({ type: 'unsubscribe' })
    // The child unsubscribes its native watcher and exits on its own — no force
    // kill, which is what corrupts the native watcher.
    child.emit('exit', 0, null)
    await disposed
    expect(child.killed).toBe(false)
    expect(child.listenerCount('exit')).toBe(1)

    // Idempotent: a second dispose does nothing further.
    await dispose()
    expect(
      child.sentMessages.filter((m) => (m as { type?: string }).type === 'unsubscribe')
    ).toHaveLength(1)
  })

  it('shares pending dispose work across racing callers', async () => {
    const promise = watchFileExplorerInWorker('/repo', vi.fn())
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    const dispose = await promise

    const firstDispose = dispose()
    const secondDispose = dispose()
    expect(secondDispose).toBe(firstDispose)
    expect(
      child.sentMessages.filter((m) => (m as { type?: string }).type === 'unsubscribe')
    ).toHaveLength(1)

    child.emit('exit', 0, null)
    await Promise.all([firstDispose, secondDispose])
    expect(child.killed).toBe(false)
  })

  it('force-kills the child only if it fails to exit within the timeout', async () => {
    vi.useFakeTimers()
    try {
      const promise = watchFileExplorerInWorker('/repo', vi.fn())
      const child = lastChild()
      child.emit('message', { type: 'ready' })
      const dispose = await promise

      const disposed = dispose()
      expect(child.sentMessages).toContainEqual({ type: 'unsubscribe' })
      expect(child.listenerCount('exit')).toBe(2)
      // Child is wedged and never emits exit: the backstop must kill it.
      await vi.advanceTimersByTimeAsync(10_000)
      await disposed
      expect(child.killed).toBe(true)
      expect(child.killSignal).toBe('SIGKILL')
      expect(child.listenerCount('exit')).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops forwarding events after dispose', async () => {
    const onEvents = vi.fn<(events: FsChangeEvent[]) => void>()
    const promise = watchFileExplorerInWorker('/repo', onEvents)
    const child = lastChild()
    child.emit('message', { type: 'ready' })
    const dispose = await promise
    const disposed = dispose()
    child.emit('exit', 0, null)
    await disposed
    onEvents.mockClear()

    child.emit('message', {
      type: 'events',
      events: [{ kind: 'update', absolutePath: '/repo/a.txt' }]
    })
    expect(onEvents).not.toHaveBeenCalled()
  })
})
