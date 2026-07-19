import ExpoThorDisplayModule, {
  type ThorConnectionState,
  type ThorControlEvent,
  type ThorDisplaySessionState,
  type ThorDisplayStatus
} from './ExpoThorDisplayModule'

export type { ThorConnectionState, ThorControlEvent, ThorDisplaySessionState, ThorDisplayStatus }

export function isThorDisplayModuleAvailable(): boolean {
  return ExpoThorDisplayModule != null
}

export async function startThorDisplay(force = false): Promise<ThorDisplayStatus | null> {
  return ExpoThorDisplayModule?.start(force) ?? null
}

export function stopThorDisplay(): void {
  ExpoThorDisplayModule?.stop()
}

export function updateThorDisplaySession(state: ThorDisplaySessionState): void {
  ExpoThorDisplayModule?.updateSession(state)
}

export function clearThorDisplaySession(): void {
  ExpoThorDisplayModule?.clearSession()
}

export function restoreThorDisplayDraft(text: string): void {
  ExpoThorDisplayModule?.restoreDraft(text)
}

export function setThorDisplaySending(sending: boolean): void {
  ExpoThorDisplayModule?.setSending(sending)
}

export function addThorControlListener(listener: (event: ThorControlEvent) => void): {
  remove: () => void
} {
  return ExpoThorDisplayModule?.addListener('onThorControl', listener) ?? { remove: () => {} }
}

export function addThorStatusListener(listener: (event: ThorDisplayStatus) => void): {
  remove: () => void
} {
  return ExpoThorDisplayModule?.addListener('onThorStatus', listener) ?? { remove: () => {} }
}
