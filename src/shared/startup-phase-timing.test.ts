import { describe, expect, it } from 'vitest'
import { createStartupPhaseTimer, isStartupTimingReport } from './startup-phase-timing'

describe('startup phase timing', () => {
  it('records structured phases and milestones with elapsed timings', async () => {
    let now = 100
    const timer = createStartupPhaseTimer({
      origin: 'renderer',
      now: () => now,
      details: { runtime: 'local' }
    })

    timer.markMilestone('hydration-effect-start')
    const value = timer.measureSync('settings.fetch', () => {
      now += 12.3
      return 'settings'
    })
    await timer.measure('session.read', async () => {
      now += 8.1
    })
    timer.markMilestone('first-usable-workspace', { sshConnectionCount: 0 })
    now += 4

    const report = timer.snapshot({ details: { outcome: 'ok' } })

    expect(value).toBe('settings')
    expect(report).toMatchObject({
      origin: 'renderer',
      startedAtMs: 100,
      capturedAtMs: 124.4,
      elapsedMs: 24.4,
      details: { runtime: 'local', outcome: 'ok' },
      milestones: [
        { name: 'hydration-effect-start', atMs: 100, elapsedMs: 0 },
        {
          name: 'first-usable-workspace',
          atMs: 120.4,
          elapsedMs: 20.4,
          details: { sshConnectionCount: 0 }
        }
      ],
      phases: [
        {
          name: 'settings.fetch',
          status: 'ok',
          startedAtMs: 100,
          endedAtMs: 112.3,
          durationMs: 12.3
        },
        {
          name: 'session.read',
          status: 'ok',
          startedAtMs: 112.3,
          endedAtMs: 120.4,
          durationMs: 8.1
        }
      ]
    })
    expect(isStartupTimingReport(report)).toBe(true)
  })

  it('records failed phases before rethrowing', () => {
    let now = 20
    const timer = createStartupPhaseTimer({ origin: 'main', now: () => now })

    expect(() =>
      timer.measureSync('store.init', () => {
        now += 3
        throw new Error('bad data')
      })
    ).toThrow('bad data')

    expect(timer.snapshot().phases).toEqual([
      {
        name: 'store.init',
        status: 'error',
        startedAtMs: 20,
        endedAtMs: 23,
        durationMs: 3,
        details: { error: 'bad data', name: 'Error' }
      }
    ])
  })

  it('rejects malformed timing reports', () => {
    expect(isStartupTimingReport({ origin: 'renderer', phases: [], milestones: [] })).toBe(false)
    expect(
      isStartupTimingReport({
        origin: 'renderer',
        startedAtMs: 0,
        capturedAtMs: 1,
        elapsedMs: 1,
        phases: [{ name: 'phase', status: 'ok', startedAtMs: 0, endedAtMs: 1 }],
        milestones: []
      })
    ).toBe(false)
  })
})
