import { WslWatcherCompatibilityError } from './filesystem-watcher-wsl-runtime'

export function isPermanentWslNativeFailure(error: unknown): boolean {
  return (
    error instanceof WslWatcherCompatibilityError ||
    (error instanceof Error &&
      error.message.startsWith('Packaged managed WSL watcher resource is missing'))
  )
}
