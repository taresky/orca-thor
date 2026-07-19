import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearThorSecondaryContent,
  getThorSecondaryContentSnapshot,
  publishThorSecondaryContent,
  subscribeThorSecondaryContent
} from './thor-secondary-content-store'

describe('thor secondary content store', () => {
  beforeEach(() => {
    const owner = getThorSecondaryContentSnapshot().owner
    if (owner) {
      clearThorSecondaryContent(owner)
    }
  })

  it('publishes the active session content and notifies the secondary surface', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeThorSecondaryContent(listener)
    const content = 'session controls'

    publishThorSecondaryContent('host-a:worktree-a', content)

    expect(getThorSecondaryContentSnapshot()).toEqual({
      owner: 'host-a:worktree-a',
      content
    })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('does not let stale route cleanup clear the current session', () => {
    publishThorSecondaryContent('old-session', 'old controls')
    publishThorSecondaryContent('new-session', 'new controls')

    clearThorSecondaryContent('old-session')

    expect(getThorSecondaryContentSnapshot()).toEqual({
      owner: 'new-session',
      content: 'new controls'
    })
  })

  it('clears content when its owning session unmounts', () => {
    publishThorSecondaryContent('active-session', 'controls')

    clearThorSecondaryContent('active-session')

    expect(getThorSecondaryContentSnapshot()).toEqual({ owner: null, content: null })
  })
})
