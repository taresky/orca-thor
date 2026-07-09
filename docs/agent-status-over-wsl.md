# Agent Status over WSL (STA-1515)

Status: design + full implementation context. Owner: brennanb2025. Linear: STA-1515.
Precedent this mirrors: the SSH agent-hook relay (`src/relay/agent-hook-server.ts`,
`src/shared/agent-hook-relay.ts`, ingest at `agentHookServer.ingestRemote` in
`src/main/agent-hooks/server.ts`).

## Background — how we got here

GitHub issue `7565` reported OMP agents in WSL worktrees disappearing from the worktree
sidebar after v1.4.124. Diagnosis split it into a regression and a pre-existing class gap:

- The **regression** was a title-normalization change (PR `7447`) that stopped idle OMP
  titles from producing the sidebar's title-derived fallback row. Decision: the sidebar is
  moving to **hook-driven rows only** (fallback removal in flight, separate PR), so the
  fallback was not restored.
- The **class gap** is that agent hooks have never worked from inside WSL for any agent.
  Two scoped PRs fixed it for OMP alone (merged, live-validated on a Windows+WSL2-NAT rig):
  - PR `7642` — Orca-managed WSL shells wrap interactive `omp` invocations with
    `--extension "$ORCA_OMP_STATUS_EXTENSION"` (the env var is WSLENV `/p`-translated so
    the WSL process reads the extension out of the Windows filesystem via `/mnt/c`).
  - PR `7641` — when the extension's loopback POST cannot connect, it delivers via
    Windows-side `/mnt/c/Windows/System32/curl.exe` (a Windows process, so *its*
    `127.0.0.1` is the loopback Orca actually binds). Fire-and-forget spawn,
    `--noproxy 127.0.0.1`, memoized WSL/curl probes, load-tolerant timeouts
    (`--connect-timeout 3 --max-time 10`; 0.5s dropped events under load).

This document is the full context for the general fix: every other hook client is still
dead from WSL, and the hooks-only sidebar change makes this work the gate for the
Windows+WSL story.

## Why hooks don't work on Windows+WSL — two independent gaps

### Gap A — transport

The hook listener binds `127.0.0.1` only, deliberately (`src/main/agent-hooks/server.ts`,
`listen(0, '127.0.0.1')`; auth via `X-Orca-Agent-Hook-Token`, 403 otherwise). Every hook
client POSTs to a hardcoded `http://127.0.0.1:$ORCA_AGENT_HOOK_PORT/hook/<source>`.

WSL2 under default **NAT** networking is a VM with its own network namespace. Microsoft's
localhost forwarding is **one-way (Windows→WSL only)**: `127.0.0.1` inside WSL is WSL's
own loopback, so every POST dies `ECONNREFUSED` — silently, because hook clients are
deliberately fail-open. Reaching Windows from WSL would require the host vNIC IP (changes
per boot) + a non-loopback listener bind + a firewall rule — all three conflict with the
loopback-only security posture.

The env coordinates DO cross correctly (`src/main/pty/wsl-orca-env.ts`
`addOrcaWslInteropEnv`: WSLENV `PORT/u TOKEN/u ENV/u VERSION/u` plus
`ORCA_AGENT_HOOK_ENDPOINT/p` path-translated; called from `src/main/ipc/pty.ts` and
`src/main/daemon/pty-subprocess.ts`). The address is simply unreachable.

Opt-in **mirrored** networking (Win11, `.wslconfig`) shares loopback and makes plain fetch
work — the fix must be inert there. Detect with `wslinfo --networking-mode`.

### Gap B — installation

Hook configs and scripts are written to the **Windows** home by every hook service:
Claude `settings.json` + managed scripts, Codex config, Gemini/Cursor/Droid/Devin/Grok/
Copilot scripts, Amp/OpenCode plugin files, the Pi/OMP extension file. An agent inside WSL
reads the **WSL-side** `$HOME` and sees none of it. There is zero WSL-targeted install
code in `src/main/agent-hooks/` or any hook service. SSH remotes have the exact precedent
needed: dedicated remote installers (`src/main/ssh/ssh-relay-session.ts` remote
settings.json handling; PR `7744` installed Droid/Copilot hooks over SSH).

Consequence: even mirrored-networking users get no hooks — transport fine, configs absent.
OMP escapes Gap B by *pointing across* the boundary (`/mnt/c` path via `/p` translation)
rather than installing WSL-side; that trick can carry file *content* for some clients, but
shell hooks still execute inside WSL and then hit Gap A regardless.

## Transport map — every client, how it posts

Endpoint file contract: `writeEndpointFile` (`src/shared/agent-hook-listener.ts`) emits
exactly four keys (`ORCA_AGENT_HOOK_PORT/TOKEN/ENV/VERSION`) to `endpoint.env` (POSIX) /
`endpoint.cmd` (Windows) — **no host field**. Shell clients source it to refresh stale
coords after an Orca restart; node clients parse it. It is never executed as a delivery
script. Clients prefer endpoint-FILE coords over env (restart re-coordination) — any
transport change must preserve that property.

| Client | Mechanism | Runtime that POSTs |
| --- | --- | --- |
| Claude, Codex, Gemini, Cursor, Droid, Devin, Grok | managed shell script | `curl` (POSIX) / `curl.exe` (Windows), built in `src/main/agent-hooks/installer-utils.ts` |
| Copilot | managed script | `curl` (POSIX) / PowerShell `Invoke-WebRequest` (Windows) |
| command-code | managed script (parse-not-source hardened) | `curl` |
| Amp, OpenCode | in-process node plugin | `fetch` |
| Pi / OMP | bundled in-process extension (`src/main/pi/agent-status-extension-source.ts`) | `fetch`, now with the WSL curl.exe fallback |

All of them target `127.0.0.1`.

## Status quo + why this gates the hooks-only sidebar

Today the worktree-card rows still have a title-derived fallback producer
(`src/renderer/src/components/sidebar/worktree-title-derived-agent-rows.ts`), so WSL users
DO currently see rows for title-rich agents (Claude `✳`/spinner titles, Gemini glyphs) —
degraded (generic text, no prompt/last-message preview, no notifications) but present.
Title-poor agents are dark (Codex — hence GH `6907`). When the hooks-only change removes
that producer, **every non-OMP agent in a WSL worktree loses its card row entirely until
this work ships**. Hook fidelity adds: prompt + last-assistant-message previews,
waiting/blocked precision, completion notifications, AI Vault / native chat session
integration.

## Solution design — WSL relay + WSL-side installation

### Transport (Gap A): guest-resident relay, host-owned stdio

Run a small receiver **inside WSL on WSL's own loopback, listening on the very port the
clients were already given** (`$ORCA_AGENT_HOOK_PORT` — free inside WSL, since that port
only exists on the Windows side). Unmodified clients then deliver successfully with
**zero client changes**; the reporter's diagnostic relay in GH `7565` proved this shape
live. Forward each parsed envelope to the Windows host over the relay's **own stdio**
(Orca spawns it via `wsl.exe`, so it owns that pipe). Ingest through the existing trust
boundary: `agentHookServer.ingestRemote` (`src/main/agent-hooks/server.ts`), envelope
shape `src/shared/agent-hook-relay.ts` — identical to the SSH relay, which runs a
loopback-only receiver on the remote box and forwards over the SSH control channel.

Lifecycle: one relay per distro; start on first WSL PTY spawn; restart if WSL restarts;
token still validated at ingest; inert under mirrored networking and on non-WSL platforms.

Design notes from a survey of comparable WSL-capable tools (kept nameless per policy):
- Guest-resident component + host-owned channel + guest-side installation, explicitly
  reusing the tool's SSH-remote machinery, **is the established pattern**. No surveyed
  tool makes guest processes dial back to a Windows-localhost listener — the merged OMP
  curl.exe stopgap is the outlier and should retire once this lands.
- Prefer host-owned **stdio** over Windows→WSL localhost port forwarding (wslhost
  forwarding is known-flaky under load; one surveyed tool dials the distro vNIC IP just to
  avoid it — stdio sidesteps the question entirely).
- WSL offers no persistent control channel between separate `wsl.exe` invocations —
  collapse the relay's ensure-installed + launch into **one idempotent script per spawn**.
- Install into the guest from inside the guest (download/extract in WSL) or stream the
  binary through `wsl.exe` stdin — not by copying through `/mnt/c`.

### Installation (Gap B): WSL-side hook installers

Write agent hook configs/scripts into the WSL-side home, per agent, analogous to the SSH
remote installers — via `wsl.exe`-executed scripts (preferred, mirrors SSH most closely)
or `\\wsl.localhost\<distro>\...` writes. Without this half, the relay receives nothing:
the hook clients themselves are absent from the WSL filesystem.

## Alternatives considered (and why not)

1. **Endpoint-file host/URL field** — the file already crosses into WSL (`/p`-translated),
   but clients read only PORT/TOKEN and hardcode the host, so all ~13 still need edits;
   and a WSL-reachable listener bind breaks the loopback-only posture (LAN exposure,
   firewall prompts).
2. **Replicate the curl.exe bridge per client** — the shell clients share ~2 generated
   builders so it is cheaper than it sounds, but it is N point fixes, requires WSL interop
   enabled (`/etc/wsl.conf` can disable it), pays a per-event process spawn (load-sensitive,
   see validation facts), and keeps the ecosystem-outlier direction.
3. **Listener-side bind changes / rely on mirrored networking** — posture conflict /
   opt-in only.
4. **OSC 9999 in-band status** (`src/shared/agent-status-osc.ts`, parsed per-pane in
   `pty-transport.ts` and `orca-runtime.ts`) — zero-network and pane-attributed, but only
   viable for in-process clients and carries status payloads, not the full hook event
   vocabulary (prompts, tools, completion) — cannot replace the pipeline.

## Facts + gotchas from the 2026-07-08 Windows-rig validation

- curl.exe interop delivery works under NAT (shipped for OMP), but per-event process spawn
  is load-sensitive: `--connect-timeout 0.5` dropped 3/3 events to a *healthy* listener
  under load; fine at 3s. A resident relay avoids per-event spawns entirely.
- `wslinfo --networking-mode` distinguishes NAT vs mirrored.
- Clients prefer endpoint-FILE coords over env. Testing gotcha: unset
  `ORCA_AGENT_HOOK_ENDPOINT` in synthetic tests or events go to the real running app.
- Server ingest silently drops paneKeys that are not `uuid:uuid`-shaped — use real-shaped
  keys in synthetic validation.
- OMP is a Bun single-file binary; Bun's `node:child_process`/`fetch` compat held. Other
  in-process clients run inside their agents' runtimes — verify per runtime.
- Environmental: fresh WSL 2.7.10 intermittently threw "Catastrophic failure
  (E_UNEXPECTED)" from `wsl.exe -d <distro> -- bash -lc` under concurrent spawn load
  (cleared by `wsl --terminate`). The relay spawn path should tolerate/retry this.
- Fork-PR CI runs sit in `action_required` until approved:
  `gh api repos/stablyai/orca/actions/runs/<id>/approve -X POST`.

## Acceptance

On a default-config Windows 11 + WSL2 **NAT** machine: launch **Codex or Claude**
(explicitly not OMP) in a WSL worktree → live hook-driven worktree-card row with status
transitions and a completion notification; hook listener still bound to Windows loopback
only; zero per-client transport changes; hooks installed WSL-side automatically (no manual
config); inert under mirrored networking and on non-WSL platforms.

## References

- GitHub: issues `6907` (Codex/WSL), `7091` + `7565` (OMP, fixed), `7563` (WSL CLI
  detection, adjacent); PRs `7642` + `7641` (OMP fixes), `7744` (SSH hook installers
  precedent), `7447` (title-collapse regression).
- Linear: STA-1515 (this work; ticket comments carry the same context).
- Key files: `src/main/agent-hooks/server.ts`, `src/shared/agent-hook-listener.ts`,
  `src/shared/agent-hook-relay.ts`, `src/relay/agent-hook-server.ts`, `src/relay/relay.ts`,
  `src/main/pty/wsl-orca-env.ts`, `src/main/agent-hooks/installer-utils.ts`,
  `src/main/pi/agent-status-extension-source.ts`, `src/main/ssh/ssh-relay-session.ts`,
  `src/main/providers/windows-shell-args.ts`, `src/shared/wsl-login-shell-command.ts`.
