import { describe, expect, it } from 'vitest'
import { parseArgs, isSuppressibleDaemonNativeError } from './daemon-entry'

describe('daemon-entry parseArgs', () => {
  it('parses --socket and --token flags', () => {
    const result = parseArgs(['--socket', '/tmp/test.sock', '--token', '/tmp/test.token'])
    expect(result).toEqual({
      socketPath: '/tmp/test.sock',
      tokenPath: '/tmp/test.token'
    })
  })

  it('handles flags in any order', () => {
    const result = parseArgs(['--token', '/tmp/t.token', '--socket', '/tmp/t.sock'])
    expect(result).toEqual({
      socketPath: '/tmp/t.sock',
      tokenPath: '/tmp/t.token'
    })
  })

  it('throws when --socket is missing', () => {
    expect(() => parseArgs(['--token', '/tmp/t.token'])).toThrow('Usage:')
  })

  it('throws when --token is missing', () => {
    expect(() => parseArgs(['--socket', '/tmp/t.sock'])).toThrow('Usage:')
  })

  it('throws with no args', () => {
    expect(() => parseArgs([])).toThrow('Usage:')
  })
})

describe('isSuppressibleDaemonNativeError', () => {
  it('suppresses node-pty native errors matched by message substring', () => {
    for (const msg of ['pty write failed', 'Pty died', 'EIO', 'read EPIPE', 'EBADF', 'ENXIO']) {
      expect(isSuppressibleDaemonNativeError(new Error(msg))).toBe(true)
    }
  })

  it('suppresses an empty, stackless Napi::Error (the #5377/#6635 signature)', () => {
    // A native abort surfaces as an Error with no message and a stack that is
    // just the "Error" header — no JS " at " frames. Build it by clearing the
    // fields rather than `new Error('')`, which the empty-message lint forbids.
    const napiError = new Error('placeholder')
    napiError.message = ''
    napiError.stack = 'Error'
    expect(isSuppressibleDaemonNativeError(napiError)).toBe(true)
  })

  it('does NOT suppress a genuine JS logic bug (has a JS stack)', () => {
    const bug = new Error('placeholder')
    bug.message = ''
    bug.stack = 'Error\n    at someFunction (/app/out/main/index.js:10:5)'
    expect(isSuppressibleDaemonNativeError(bug)).toBe(false)
  })

  it('does NOT suppress an error with a meaningful message', () => {
    expect(isSuppressibleDaemonNativeError(new Error('Cannot read properties of undefined'))).toBe(
      false
    )
  })

  it('does NOT suppress non-Error throwables', () => {
    expect(isSuppressibleDaemonNativeError('boom')).toBe(false)
    expect(isSuppressibleDaemonNativeError(undefined)).toBe(false)
    expect(isSuppressibleDaemonNativeError({ name: 'TypeError', message: '' })).toBe(false)
  })
})
