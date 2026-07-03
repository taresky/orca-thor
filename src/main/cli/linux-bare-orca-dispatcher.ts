import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getBundledLauncherPath } from './cli-installer'

export type LinuxBareOrcaDispatcherOptions = {
  /** Packaged app resources root; the bundled `orca-ide` launcher lives under it. */
  resourcesPath: string
  /** Test seam — defaults to the real home directory. */
  homePath?: string
}

export type LinuxBareOrcaDispatcherResult = {
  dispatcherPath: string
  target: string
}

// Why: on Linux the CLI installs as `orca-ide`, not bare `orca`, to avoid
// shadowing GNOME Orca's /usr/bin/orca. But the Claude Team launcher typed into
// the initial managed terminal invokes the literal `orca claude-teams`, so a
// headless serve box needs a bare-`orca` dispatcher on the managed-terminal PATH.
// ~/.local/bin sits ahead of /usr/bin there via patchPackagedProcessPath. It is a
// plain file, not a managed symlink, so CliInstaller.removeLegacyLinuxCommandIfManaged
// never reclaims it; the GNOME-Orca shadow the `orca-ide` rename avoids is moot on
// a headless serve box.
export async function installLinuxBareOrcaDispatcher(
  options: LinuxBareOrcaDispatcherOptions
): Promise<LinuxBareOrcaDispatcherResult> {
  const target = getBundledLauncherPath('linux', options.resourcesPath)
  if (!target) {
    throw new Error('Bundled orca-ide launcher path is unavailable on this build.')
  }

  const localBin = join(options.homePath ?? homedir(), '.local', 'bin')
  const dispatcherPath = join(localBin, 'orca')
  await mkdir(localBin, { recursive: true })
  await writeFile(dispatcherPath, buildDispatcherScript(target), 'utf8')
  await chmod(dispatcherPath, 0o755)
  return { dispatcherPath, target }
}

function buildDispatcherScript(target: string): string {
  // Why: JSON.stringify quotes the bundled path so a resourcesPath containing
  // spaces or shell metacharacters cannot break out of the exec line.
  return `#!/usr/bin/env bash\nexec ${JSON.stringify(target)} "$@"\n`
}
