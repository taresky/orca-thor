import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  computeTrustKey,
  computeTrustedHash,
  upsertHookTrustEntries,
  type CodexTrustEntry
} from './config-toml-trust'

// Why: this hash was captured from a real Codex 0.129 `/hooks` approval. If
// Codex changes its serialization or normalization rules, this test fails
// loudly instead of silently shipping bad trust entries that put hooks back
// into the review pile.
const REAL_APPROVED_COMMAND = '/bin/sh "/tmp/orca-case-b-mCmCe6/agent-hooks/codex-hook.sh"'
const REAL_APPROVED_HASH = 'sha256:bc013489dba495431d3790fda62ee5a7d907a7c491e29ad26238c3a5d6d2b163'

let tmpDir: string
let configPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'orca-codex-trust-test-'))
  configPath = join(tmpDir, 'config.toml')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('computeTrustedHash', () => {
  it('reproduces the hash that Codex /hooks wrote for a real approval', () => {
    expect(
      computeTrustedHash({
        sourcePath: '/Users/thebr/.codex/hooks.json',
        eventLabel: 'pre_tool_use',
        groupIndex: 0,
        handlerIndex: 0,
        command: REAL_APPROVED_COMMAND
      })
    ).toBe(REAL_APPROVED_HASH)
  })

  it('produces a different hash when the command changes', () => {
    const a = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'foo'
    })
    const b = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'bar'
    })
    expect(a).not.toBe(b)
  })

  it('produces a different hash when the event label changes', () => {
    const a = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'foo'
    })
    const b = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'post_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'foo'
    })
    expect(a).not.toBe(b)
  })

  it('ignores groupIndex/handlerIndex (those are part of the key, not the hash)', () => {
    const a = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'foo'
    })
    const b = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 99,
      handlerIndex: 99,
      command: 'foo'
    })
    expect(a).toBe(b)
  })

  it('hashes a missing matcher the same as no matcher field', () => {
    const a = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'foo'
    })
    const b = computeTrustedHash({
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'foo',
      matcher: undefined
    })
    expect(a).toBe(b)
  })
})

describe('computeTrustKey', () => {
  it('joins source path, event label, group index, handler index with colons', () => {
    expect(
      computeTrustKey({
        sourcePath: '/Users/thebr/.codex/hooks.json',
        eventLabel: 'pre_tool_use',
        groupIndex: 0,
        handlerIndex: 0,
        command: 'irrelevant'
      })
    ).toBe('/Users/thebr/.codex/hooks.json:pre_tool_use:0:0')
  })
})

describe('upsertHookTrustEntries', () => {
  it('creates the file with a trust block when none exists', () => {
    const entry: CodexTrustEntry = {
      sourcePath: '/foo/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: '/bin/echo hi'
    }
    upsertHookTrustEntries(configPath, [entry])

    const written = readFileSync(configPath, 'utf-8')
    expect(written).toContain(`[hooks.state."/foo/hooks.json:pre_tool_use:0:0"]`)
    expect(written).toContain('enabled = true')
    expect(written).toContain(`trusted_hash = "${computeTrustedHash(entry)}"`)
  })

  it('appends to an existing config without disturbing prior content', () => {
    const original = [
      'model = "gpt-5.5"',
      'approval_policy = "never"',
      '',
      '[features]',
      'hooks = true',
      ''
    ].join('\n')
    writeFileSync(configPath, original, 'utf-8')

    upsertHookTrustEntries(configPath, [
      {
        sourcePath: '/x/hooks.json',
        eventLabel: 'session_start',
        groupIndex: 0,
        handlerIndex: 0,
        command: 'echo hello'
      }
    ])

    const written = readFileSync(configPath, 'utf-8')
    expect(written.startsWith(original.trimEnd())).toBe(true)
    expect(written).toContain('[hooks.state."/x/hooks.json:session_start:0:0"]')
  })

  it('replaces an existing block keyed at the same path without touching unrelated blocks', () => {
    const key = '/x/hooks.json:pre_tool_use:0:0'
    const original = [
      '[features]',
      'hooks = true',
      '',
      `[hooks.state."${key}"]`,
      'enabled = true',
      'trusted_hash = "sha256:STALE"',
      '',
      '[unrelated]',
      'value = 42',
      ''
    ].join('\n')
    writeFileSync(configPath, original, 'utf-8')

    upsertHookTrustEntries(configPath, [
      {
        sourcePath: '/x/hooks.json',
        eventLabel: 'pre_tool_use',
        groupIndex: 0,
        handlerIndex: 0,
        command: 'echo new'
      }
    ])

    const written = readFileSync(configPath, 'utf-8')
    expect(written).not.toContain('STALE')
    expect(written).toContain('[unrelated]')
    expect(written).toContain('value = 42')
    // Why: we only own the [hooks.state."<key>"] block — the [features]
    // block must be unchanged.
    expect(written).toContain('[features]\nhooks = true')
  })

  it('writes a single block per entry even when called repeatedly', () => {
    const entry: CodexTrustEntry = {
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'echo'
    }
    upsertHookTrustEntries(configPath, [entry])
    upsertHookTrustEntries(configPath, [entry])
    upsertHookTrustEntries(configPath, [entry])

    const written = readFileSync(configPath, 'utf-8')
    const occurrences = written.match(/\[hooks\.state\./g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('writes a .bak file before overwriting an existing config', () => {
    writeFileSync(configPath, 'model = "old"\n', 'utf-8')
    upsertHookTrustEntries(configPath, [
      {
        sourcePath: '/x/hooks.json',
        eventLabel: 'pre_tool_use',
        groupIndex: 0,
        handlerIndex: 0,
        command: 'echo'
      }
    ])
    expect(existsSync(`${configPath}.bak`)).toBe(true)
    expect(readFileSync(`${configPath}.bak`, 'utf-8')).toBe('model = "old"\n')
  })

  it('does not write at all when the file already has the right hash', () => {
    const entry: CodexTrustEntry = {
      sourcePath: '/x/hooks.json',
      eventLabel: 'pre_tool_use',
      groupIndex: 0,
      handlerIndex: 0,
      command: 'echo'
    }
    upsertHookTrustEntries(configPath, [entry])
    const firstWrite = readFileSync(configPath, 'utf-8')
    // Why: a no-op upsert must not roll the .bak forward — repeated calls
    // (e.g. from app start) would otherwise destroy the last recoverable copy.
    rmSync(`${configPath}.bak`, { force: true })
    upsertHookTrustEntries(configPath, [entry])
    expect(existsSync(`${configPath}.bak`)).toBe(false)
    expect(readFileSync(configPath, 'utf-8')).toBe(firstWrite)
  })
})
