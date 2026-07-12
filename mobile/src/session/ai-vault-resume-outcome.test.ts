import { describe, expect, it } from 'vitest'
import { resolveMobileResumeOutcomeDisplay } from './ai-vault-resume-outcome'

describe('mobile resume outcome display', () => {
  it('offers an explicit launch-with-current-settings action on an invalid snapshot', () => {
    const display = resolveMobileResumeOutcomeDisplay({
      kind: 'failed',
      code: 'invalid_launch_snapshot'
    })

    expect(display.tone).toBe('error')
    expect(display.action).toEqual({
      id: 'launch-current-settings',
      label: 'Launch with current settings'
    })
  })

  it('does not offer an action for other failure codes', () => {
    const display = resolveMobileResumeOutcomeDisplay({ kind: 'failed', code: 'spawn_failed' })

    expect(display.tone).toBe('error')
    expect(display.action).toBeUndefined()
  })

  it('confirms a clean launch when no notices are present', () => {
    const display = resolveMobileResumeOutcomeDisplay({ kind: 'launched' })

    expect(display).toEqual({ tone: 'success', message: 'Agent session queued.' })
  })

  it('reports withheld environment values as a non-blocking notice', () => {
    const display = resolveMobileResumeOutcomeDisplay({
      kind: 'launched',
      notices: ['env_withheld']
    })

    expect(display.tone).toBe('info')
    expect(display.action).toBeUndefined()
    expect(display.message).toContain('environment')
  })

  it('keeps snapshot-changed copy free of any env-value implication', () => {
    const display = resolveMobileResumeOutcomeDisplay({
      kind: 'launched',
      notices: ['snapshot_definition_changed']
    })

    expect(display.tone).toBe('info')
    expect(display.message.toLowerCase()).not.toContain('environment')
    expect(display.message.toLowerCase()).not.toContain('value')
  })

  it('combines both notices into one info message', () => {
    const display = resolveMobileResumeOutcomeDisplay({
      kind: 'launched',
      notices: ['snapshot_definition_changed', 'env_withheld']
    })

    expect(display.tone).toBe('info')
    expect(display.message).toContain('environment')
    expect(display.message).toContain('settings saved when this session started')
  })
})
