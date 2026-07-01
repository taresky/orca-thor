import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    isPackaged: false,
    getVersion: vi.fn(() => '0.0.0'),
    commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => '') }
  }
}))

type Handlers = {
  uncaughtExceptionMonitor?: (error: unknown) => void
  unhandledRejection?: (reason: unknown) => void
}

function captureHandlers(): Handlers {
  const handlers: Handlers = {}
  const originalOn = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation(((event, listener) => {
    if (event === 'uncaughtExceptionMonitor') {
      handlers.uncaughtExceptionMonitor = listener as (error: unknown) => void
      return process
    }
    if (event === 'unhandledRejection') {
      handlers.unhandledRejection = listener as (reason: unknown) => void
      return process
    }
    return originalOn(event, listener)
  }) as typeof process.on)
  return handlers
}

describe('installServeObservability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs an identifiable [serve] line with stack on uncaught exception', async () => {
    const { installServeObservability } = await import('./configure-process')
    const handlers = captureHandlers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    installServeObservability()
    const err = new Error('napi blew up')
    err.stack = 'Error: napi blew up\n    at watcher (/app/out/main/index.js:1:1)'
    // Must not throw or become a recovery handler; the fatal path owns exit.
    expect(() => handlers.uncaughtExceptionMonitor?.(err)).not.toThrow()

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('[serve] Uncaught exception')
    expect(logged).toContain('napi blew up')
    expect(logged).toContain('at watcher')
  })

  it('does not log pipe errors (EIO/EPIPE) which are expected on teardown', async () => {
    const { installServeObservability } = await import('./configure-process')
    const handlers = captureHandlers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    installServeObservability()
    const pipe = new Error('write EPIPE') as NodeJS.ErrnoException
    pipe.code = 'EPIPE'
    handlers.uncaughtExceptionMonitor?.(pipe)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs unhandled promise rejections with a [serve] tag and re-raises to preserve fatality', async () => {
    const { installServeObservability } = await import('./configure-process')
    const handlers = captureHandlers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let scheduled: (() => void) | null = null
    vi.spyOn(globalThis, 'setImmediate').mockImplementation(((callback) => {
      scheduled = callback as () => void
      return {} as NodeJS.Immediate
    }) as typeof setImmediate)

    installServeObservability()
    const reason = new Error('rejected')
    handlers.unhandledRejection?.(reason)

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('[serve] Unhandled promise rejection')
    expect(logged).toContain('rejected')
    // Observability must not change fatality: the rejection is re-raised so the
    // default fatal path still runs.
    expect(scheduled).not.toBeNull()
    expect(() => scheduled?.()).toThrow(reason)
  })
})
