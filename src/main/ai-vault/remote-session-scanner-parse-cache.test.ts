import { beforeEach, describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../shared/execution-host'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { scanRemoteAiVaultSessions } from './remote-session-scanner'
import {
  evictRemoteSessionParseCache,
  readCachedRemoteSessionParse,
  REMOTE_PARSE_CACHE_MAX_ENTRIES_PER_HOST,
  resetRemoteSessionParseCacheForTests,
  storeRemoteSessionParse
} from './remote-session-scanner-parse-cache'
import {
  codexTranscript,
  jsonLines,
  MemoryRemoteProvider
} from './remote-session-scanner-test-provider'
import type { FileWithMtime } from './session-scanner-types'

const CLAUDE_ONE = '/home/ada/.claude/projects/repo/one.jsonl'
const CLAUDE_TWO = '/home/ada/.claude/projects/repo/two.jsonl'
const CODEX_A = '/home/ada/.codex/sessions/codex-a.jsonl'

function scan(provider: MemoryRemoteProvider, executionHostId: ExecutionHostId = 'ssh:dev-box') {
  return scanRemoteAiVaultSessions({
    provider,
    executionHostId,
    remoteHome: '/home/ada',
    hostPlatform: getRemoteHostPlatform('linux-x64')
  })
}

function claudeTranscript(args: { sessionId: string; title: string; messages?: number }): string {
  const records: unknown[] = [
    {
      sessionId: args.sessionId,
      timestamp: '2026-07-04T04:00:00.000Z',
      type: 'user',
      cwd: '/home/ada/repo',
      message: { content: [{ type: 'text', text: args.title }] }
    }
  ]
  for (let index = 1; index < (args.messages ?? 2); index++) {
    records.push({
      sessionId: args.sessionId,
      timestamp: `2026-07-04T04:00:0${index}.000Z`,
      type: 'assistant',
      message: { model: 'claude-opus-4', content: `Answer ${index}` }
    })
  }
  return jsonLines(records)
}

function fileAt(path: string, mtimeMs = 1): FileWithMtime {
  return { path, mtimeMs, modifiedAt: new Date(mtimeMs).toISOString(), sizeBytes: 1 }
}

describe('remote session parse cache', () => {
  beforeEach(() => {
    resetRemoteSessionParseCacheForTests()
  })

  it('reads every body once, then rescans unchanged files with zero reads', async () => {
    const provider = new MemoryRemoteProvider()
    provider.addFile(CLAUDE_ONE, claudeTranscript({ sessionId: 'one', title: 'First' }), 10)
    provider.addFile(CLAUDE_TWO, claudeTranscript({ sessionId: 'two', title: 'Second' }), 20)
    provider.addFile(
      CODEX_A,
      codexTranscript({
        sessionId: 'codex-a',
        title: 'Codex session',
        cwd: '/home/ada/repo',
        timestamp: '2026-07-04T05:00:00.000Z'
      }),
      30
    )

    const first = await scan(provider)
    expect(first.issues).toEqual([])
    expect(first.sessions).toHaveLength(3)
    const firstReads = new Set(provider.readFileCalls)
    expect(firstReads).toContain(CLAUDE_ONE)
    expect(firstReads).toContain(CLAUDE_TWO)
    expect(firstReads).toContain(CODEX_A)

    provider.clearReadFileCalls()
    const second = await scan(provider)
    expect(provider.readFileCalls).toEqual([])
    expect(second.sessions).toEqual(first.sessions)
    expect(second.issues).toEqual([])
  })

  it('re-reads exactly the file whose mtime changed', async () => {
    const provider = new MemoryRemoteProvider()
    provider.addFile(CLAUDE_ONE, claudeTranscript({ sessionId: 'one', title: 'First' }), 10)
    provider.addFile(CLAUDE_TWO, claudeTranscript({ sessionId: 'two', title: 'Second' }), 20)
    await scan(provider)

    provider.addFile(
      CLAUDE_TWO,
      claudeTranscript({ sessionId: 'two', title: 'Second', messages: 3 }),
      25
    )
    provider.clearReadFileCalls()
    const result = await scan(provider)

    expect(provider.readFileCalls).toEqual([CLAUDE_TWO])
    expect(result.sessions.find((session) => session.sessionId === 'two')?.messageCount).toBe(3)
  })

  it('re-reads a file whose size changed even when the mtime did not', async () => {
    const provider = new MemoryRemoteProvider()
    provider.addFile(CLAUDE_ONE, claudeTranscript({ sessionId: 'one', title: 'First' }), 10)
    await scan(provider)

    provider.addFile(
      CLAUDE_ONE,
      claudeTranscript({ sessionId: 'one', title: 'First', messages: 4 }),
      10
    )
    provider.clearReadFileCalls()
    const result = await scan(provider)

    expect(provider.readFileCalls).toEqual([CLAUDE_ONE])
    expect(result.sessions[0]?.messageCount).toBe(4)
  })

  it('never serves entries cached for one host to another host', async () => {
    const content = claudeTranscript({ sessionId: 'shared', title: 'Same path everywhere' })
    const providerA = new MemoryRemoteProvider()
    providerA.addFile(CLAUDE_ONE, content, 10)
    await scan(providerA, 'ssh:host-a')

    const providerB = new MemoryRemoteProvider()
    providerB.addFile(CLAUDE_ONE, content, 10)
    const result = await scan(providerB, 'ssh:host-b')

    expect(providerB.readFileCalls).toContain(CLAUDE_ONE)
    expect(result.sessions[0]?.executionHostId).toBe('ssh:host-b')
  })

  it('re-reads bodies after the host cache is evicted', async () => {
    const provider = new MemoryRemoteProvider()
    provider.addFile(CLAUDE_ONE, claudeTranscript({ sessionId: 'one', title: 'First' }), 10)
    await scan(provider)

    evictRemoteSessionParseCache('ssh:dev-box')
    provider.clearReadFileCalls()
    await scan(provider)

    expect(provider.readFileCalls).toEqual([CLAUDE_ONE])
  })

  it('bounds entries per host, evicting least recently used first', () => {
    storeRemoteSessionParse('ssh:host-b', fileAt('/other-host'), null)
    for (let index = 0; index < REMOTE_PARSE_CACHE_MAX_ENTRIES_PER_HOST; index++) {
      storeRemoteSessionParse('ssh:host-a', fileAt(`/f${index}`), null)
    }

    // Reading /f0 refreshes its recency, so the overflow evicts /f1 instead.
    expect(readCachedRemoteSessionParse('ssh:host-a', fileAt('/f0'))).not.toBeNull()
    storeRemoteSessionParse('ssh:host-a', fileAt('/overflow'), null)

    expect(readCachedRemoteSessionParse('ssh:host-a', fileAt('/f1'))).toBeNull()
    expect(readCachedRemoteSessionParse('ssh:host-a', fileAt('/f0'))).not.toBeNull()
    expect(readCachedRemoteSessionParse('ssh:host-a', fileAt('/overflow'))).not.toBeNull()
    expect(readCachedRemoteSessionParse('ssh:host-b', fileAt('/other-host'))).not.toBeNull()
  })

  it('misses when the stat changed and when the host was never scanned', () => {
    storeRemoteSessionParse('ssh:host-a', fileAt('/f', 1), null)
    expect(readCachedRemoteSessionParse('ssh:host-a', fileAt('/f', 2))).toBeNull()
    expect(readCachedRemoteSessionParse('ssh:host-c', fileAt('/f', 1))).toBeNull()
  })
})
