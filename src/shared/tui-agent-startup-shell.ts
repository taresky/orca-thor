import { tokenizeCustomCommandTemplate } from './commit-message-prompt'

export type AgentStartupShell = 'posix' | 'powershell' | 'cmd'

export function resolveStartupShell(
  platform: NodeJS.Platform,
  shell?: AgentStartupShell
): AgentStartupShell {
  return shell ?? (platform === 'win32' ? 'powershell' : 'posix')
}

export function quoteStartupArg(value: string, shell: AgentStartupShell): string {
  if (shell === 'powershell') {
    // Why: PowerShell treats the Unicode quotation marks U+2018-U+201B as
    // single-quote string delimiters exactly like ASCII ' — all five must be
    // doubled or a smart quote in a path/prompt terminates the string early.
    return `'${value.replace(/(['‘’‚‛])/g, '$1$1')}'`
  }
  if (shell === 'cmd') {
    // Why: inside cmd double quotes a caret is a LITERAL character, so the old
    // caret-escaping corrupted data ("C:\Foo & Bar" reached the program as
    // C:\Foo ^& Bar). & | < > ( ) are neutral inside the quotes and must pass
    // through unchanged. %…%/delayed-! expansion and embedded " still apply
    // inside cmd quotes and cannot be encoded faithfully — resolver-managed
    // launches reject custom-supplied elements containing % ! " ^ before any
    // writer runs (cmd_metachar); this quoter passes them through as-is.
    return `"${value}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Characters cmd cannot faithfully deliver inside a double-quoted argv element:
 *  %…% / delayed-! expansion still applies and embedded quotes re-split the
 *  line. Custom-supplied elements containing one of these fail closed when the
 *  target shell is cmd. */
export const CMD_UNENCODABLE_CHAR_RE = /[%!^"]/

export function buildShellCommandFromArgv(
  args: readonly string[],
  shell: AgentStartupShell
): string {
  const command = args.map((arg) => quoteStartupArg(arg, shell)).join(' ')
  if (shell === 'powershell' && command) {
    return `& ${command}`
  }
  return command
}

export function clearEnvCommand(name: string, shell: AgentStartupShell): string {
  if (shell === 'powershell') {
    return `Remove-Item Env:${name} -ErrorAction SilentlyContinue`
  }
  if (shell === 'cmd') {
    return `set "${name}="`
  }
  return `unset ${name}`
}

export function commandSeparator(shell: AgentStartupShell): string {
  return shell === 'cmd' ? ' & ' : '; '
}

export type BuiltInAgentArgsTokenization =
  | { ok: true; tokens: string[] }
  | { ok: false; error: string }

// Token-returning read path for built-in `agentDefaultArgs`. This adapter owns
// whichever shipped shell-independent grammar is current (`tokenizeCustomCommandTemplate`);
// never used for custom args, which have their own grammar.
export function tokenizeBuiltInAgentArgs(
  agentArgs: string | null | undefined
): BuiltInAgentArgsTokenization {
  const trimmed = agentArgs?.trim()
  if (!trimmed) {
    return { ok: true, tokens: [] }
  }
  const tokenized = tokenizeCustomCommandTemplate(trimmed)
  if (!tokenized.ok) {
    return { ok: false, error: `CLI arguments are invalid: ${tokenized.error}` }
  }
  return { ok: true, tokens: tokenized.tokens }
}

export type AgentCliArgsPlan = { ok: true; suffix: string } | { ok: false; error: string }

export function planAgentCliArgsSuffix(
  agentArgs: string | null | undefined,
  shell: AgentStartupShell
): AgentCliArgsPlan {
  const tokenized = tokenizeBuiltInAgentArgs(agentArgs)
  if (!tokenized.ok) {
    return { ok: false, error: tokenized.error }
  }
  return {
    ok: true,
    suffix: tokenized.tokens.map((token) => quoteStartupArg(token, shell)).join(' ')
  }
}
