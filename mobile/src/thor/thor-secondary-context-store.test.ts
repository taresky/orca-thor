import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearThorSecondaryContext,
  getThorSecondaryContextSnapshot,
  publishThorSecondaryContext,
  subscribeThorSecondaryContext
} from './thor-secondary-context-store'

describe('thor secondary context store', () => {
  beforeEach(() => {
    const owner = getThorSecondaryContextSnapshot().owner
    if (owner) {
      clearThorSecondaryContext(owner)
    }
  })

  it('publishes contextual controls and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeThorSecondaryContext(listener)
    publishThorSecondaryContext('browser', 'controls')
    expect(getThorSecondaryContextSnapshot()).toEqual({ owner: 'browser', content: 'controls' })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('does not let stale cleanup clear the active controls', () => {
    publishThorSecondaryContext('browser', 'browser controls')
    publishThorSecondaryContext('chat', 'chat controls')
    clearThorSecondaryContext('browser')
    expect(getThorSecondaryContextSnapshot()).toEqual({
      owner: 'chat',
      content: 'chat controls'
    })
  })
})
