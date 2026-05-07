import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { createHash, randomUUID } from 'crypto'

// Why: Codex 0.129+ gates each hook on a `trusted_hash` entry in
// ~/.codex/config.toml under [hooks.state."<key>"]. Without it the hook is in
// the "review required" pile and never fires, so the agent-status sidebar
// silently goes blank. We reproduce Codex's hash so install() can register
// trust the same way `/hooks` would. Algorithm reverse-engineered from
// codex-rs/hooks/src/engine/discovery.rs (command_hook_hash) +
// codex-rs/config/src/fingerprint.rs (version_for_toml).

export type CodexEventLabel =
  | 'pre_tool_use'
  | 'permission_request'
  | 'post_tool_use'
  | 'pre_compact'
  | 'post_compact'
  | 'session_start'
  | 'user_prompt_submit'
  | 'stop'

export type CodexTrustEntry = {
  /** Path on disk to the hooks.json that declares the hook (the "key_source"). */
  sourcePath: string
  /** Codex event label (snake_case). */
  eventLabel: CodexEventLabel
  /** 0-based index of the matcher group within the event array. */
  groupIndex: number
  /** 0-based index of the handler within the matcher group's `hooks` array. */
  handlerIndex: number
  /** The exact `command` string written to hooks.json. */
  command: string
  /** Effective timeout in seconds. Codex normalizes absent/<1 to 600. */
  timeoutSec?: number
  /** Whether the handler is async. Defaults to false. */
  async?: boolean
  /** Optional matcher pattern (only meaningful for events that support it). */
  matcher?: string
  /** Optional statusMessage field. */
  statusMessage?: string
}

// Why: matches Codex's canonical_json. Sorts object keys recursively before
// SHA-256ing; arrays preserve order.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

// Why: reproduces command_hook_hash. NormalizedHookIdentity has `group:
// MatcherGroup` flattened in, so the wire shape is { event_name, matcher?,
// hooks: [<normalized handler>] }. `matcher` is omitted (not null) when
// absent — Rust's Option<String>=None drops through the TOML→JSON path.
// Handler is normalized to timeout=600 (or explicit, min 1) and async=false.
export function computeTrustedHash(entry: CodexTrustEntry): string {
  const handler: Record<string, unknown> = {
    type: 'command',
    command: entry.command,
    timeout: Math.max(1, entry.timeoutSec ?? 600),
    async: entry.async ?? false
  }
  if (entry.statusMessage !== undefined) {
    handler.statusMessage = entry.statusMessage
  }
  const identity: Record<string, unknown> = {
    event_name: entry.eventLabel,
    hooks: [handler]
  }
  if (entry.matcher !== undefined) {
    identity.matcher = entry.matcher
  }
  const serialized = JSON.stringify(canonicalize(identity))
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

export function computeTrustKey(entry: CodexTrustEntry): string {
  return `${entry.sourcePath}:${entry.eventLabel}:${entry.groupIndex}:${entry.handlerIndex}`
}

// Why: regex-edit ~/.codex/config.toml rather than parse + reserialize. The
// file is hand-edited by users (and other tools) and a round-trip through
// any TOML library would lose comments, key ordering, and inline-table
// style. We only ever (a) replace an existing [hooks.state."<key>"] block
// keyed by *our* known hook keys, or (b) append a new block at EOF. Other
// content is byte-preserved.
export function upsertHookTrustEntries(
  configPath: string,
  entries: readonly CodexTrustEntry[]
): void {
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : ''
  let updated = existing
  for (const entry of entries) {
    updated = upsertTrustBlock(updated, computeTrustKey(entry), computeTrustedHash(entry))
  }
  if (updated === existing) {
    return
  }
  writeConfigAtomically(configPath, updated)
}

// Why: build the canonical block we own. `enabled = true` mirrors what Codex
// itself writes when the user approves via /hooks (HookStateToml fields).
function buildTrustBlock(key: string, hash: string): string {
  return [
    `[hooks.state."${escapeTomlString(key)}"]`,
    'enabled = true',
    `trusted_hash = "${escapeTomlString(hash)}"`
  ].join('\n')
}

function escapeTomlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function upsertTrustBlock(content: string, key: string, hash: string): string {
  const block = buildTrustBlock(key, hash)
  const headerPattern = buildHeaderPattern(key)
  const match = headerPattern.exec(content)
  if (!match) {
    if (content.length === 0) {
      return `${block}\n`
    }
    // Why: leave one blank line before our appended block so the file stays
    // readable, but don't compound separators when the file already ends in
    // a blank line.
    const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
    return `${content}${separator}${block}\n`
  }
  const headerStart = match.index + (match[1] ? match[1].length : 0)
  const headerLineEnd = match.index + match[0].length
  // Why: find the next top-level table header [...] so we replace ONLY this
  // block. Comments and blank lines between us and the next header are part
  // of our block and get rewritten — Codex itself only writes the two known
  // fields, so this is safe.
  const after = content.slice(headerLineEnd)
  const nextHeaderRel = findNextTableHeader(after)
  const blockEnd = nextHeaderRel === -1 ? content.length : headerLineEnd + nextHeaderRel
  return `${content.slice(0, headerStart)}${block}\n${content.slice(blockEnd)}`
}

// Why: only match a header that sits at column 0 of its line and ends the
// line. Codex emits the canonical form with the key double-quoted; we never
// share this slot with another tool, so we don't bother accepting bare
// dotted-key variants.
function buildHeaderPattern(key: string): RegExp {
  const escapedKey = escapeRegex(escapeTomlString(key))
  return new RegExp(`(^|\\n)\\[hooks\\.state\\."${escapedKey}"\\][ \\t]*\\n`)
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Why: scan for the next top-level `[name]` header. Skip array-of-tables
// `[[name]]`. We only treat lines whose first non-whitespace character is
// `[` and that close cleanly with `]` (modulo trailing comment/whitespace)
// as headers, so `[` inside string values is ignored.
function findNextTableHeader(text: string): number {
  let cursor = 0
  while (cursor < text.length) {
    const newlineIdx = text.indexOf('\n', cursor)
    const lineEnd = newlineIdx === -1 ? text.length : newlineIdx
    const line = text.slice(cursor, lineEnd).trimStart()
    if (line.startsWith('[') && !line.startsWith('[[') && /^\[[^\]]*\]\s*(#.*)?$/.test(line)) {
      return cursor
    }
    if (newlineIdx === -1) {
      return -1
    }
    cursor = newlineIdx + 1
  }
  return -1
}

// Why: same atomic-rename + .bak rotation pattern as writeHooksJson — a
// half-written config.toml can brick a user's Codex install, so write to
// tmp and rename. Random-suffix tmp name avoids cross-process races on
// rapid reinstalls.
function writeConfigAtomically(configPath: string, contents: string): void {
  const dir = dirname(configPath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  let renamed = false
  try {
    writeFileSync(tmpPath, contents, 'utf-8')
    if (existsSync(configPath)) {
      copyFileSync(configPath, `${configPath}.bak`)
    }
    renameSync(tmpPath, configPath)
    renamed = true
  } finally {
    if (!renamed && existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // best effort — surfacing the cleanup failure would mask the original write error
      }
    }
  }
}
