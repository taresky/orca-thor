import ExpoThorDisplayModule, { type ThorDisplayStatus } from './ExpoThorDisplayModule'

export type { ThorDisplayStatus }

export function isThorDisplayModuleAvailable(): boolean {
  return ExpoThorDisplayModule != null
}

export async function startThorDisplay(force = false): Promise<ThorDisplayStatus | null> {
  return ExpoThorDisplayModule?.start(force) ?? null
}

export function stopThorDisplay(): void {
  ExpoThorDisplayModule?.stop()
}

export function addThorStatusListener(listener: (event: ThorDisplayStatus) => void): {
  remove: () => void
} {
  return ExpoThorDisplayModule?.addListener('onThorStatus', listener) ?? { remove: () => {} }
}
