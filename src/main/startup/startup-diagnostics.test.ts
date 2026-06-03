import { describe, expect, it, vi } from 'vitest'
import {
  isStartupDiagnosticsEnabled,
  logStartupDiagnostic,
  logStartupTimingReport,
  STARTUP_DIAGNOSTICS_ENV,
  writeStartupDiagnosticLine
} from './startup-diagnostics'

describe('writeStartupDiagnosticLine', () => {
  it('writes directly to stderr fd 2 with a newline', () => {
    const write = vi.fn()

    writeStartupDiagnosticLine('[startup] test', write)

    expect(write).toHaveBeenCalledWith(2, '[startup] test\n')
  })
})

describe('isStartupDiagnosticsEnabled', () => {
  it('requires an explicit opt-in env flag', () => {
    expect(isStartupDiagnosticsEnabled({ [STARTUP_DIAGNOSTICS_ENV]: '1' })).toBe(true)
    expect(isStartupDiagnosticsEnabled({ [STARTUP_DIAGNOSTICS_ENV]: 'true' })).toBe(false)
    expect(isStartupDiagnosticsEnabled({})).toBe(false)
  })
})

describe('logStartupDiagnostic', () => {
  it('formats event details as a synchronous startup diagnostic line', () => {
    const write = vi.fn()

    logStartupDiagnostic('before-lock', { packaged: true, userData: '/tmp/orca' }, write)

    expect(write).toHaveBeenCalledWith(
      2,
      '[startup] before-lock packaged=true userData="/tmp/orca"\n'
    )
  })
})

describe('logStartupTimingReport', () => {
  it('formats structured startup timing records through the diagnostic sink', () => {
    const write = vi.fn()

    logStartupTimingReport(
      {
        origin: 'main',
        startedAtMs: 1,
        capturedAtMs: 5,
        elapsedMs: 4,
        phases: [
          {
            name: 'store.init',
            status: 'ok',
            startedAtMs: 1,
            endedAtMs: 3,
            durationMs: 2
          }
        ],
        milestones: [
          {
            name: 'first-window-visible',
            atMs: 5,
            elapsedMs: 4
          }
        ]
      },
      write
    )

    expect(write).toHaveBeenCalledWith(
      2,
      '[startup] timing-report report={"origin":"main","startedAtMs":1,"capturedAtMs":5,"elapsedMs":4,"phases":[{"name":"store.init","status":"ok","startedAtMs":1,"endedAtMs":3,"durationMs":2}],"milestones":[{"name":"first-window-visible","atMs":5,"elapsedMs":4}]}\n'
    )
  })
})
