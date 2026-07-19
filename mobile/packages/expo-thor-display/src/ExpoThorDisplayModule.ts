import { requireOptionalNativeModule } from 'expo-modules-core'

export type ThorControlEvent = { kind: 'submit'; text: string } | { kind: 'raw'; text: string }

export type ThorConnectionState =
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'auth-failed'

export type ThorDisplaySessionState = {
  active: boolean
  connectionState: ThorConnectionState
  terminalTitle: string
  worktreeName: string
}

export type ThorDisplayStatus = {
  activeDisplayId: number | null
  isThor: boolean
  manufacturer: string
  model: string
  secondaryDisplayCount: number
  started: boolean
}

type NativeSubscription = { remove: () => void }

type ExpoThorDisplayNativeModule = {
  addListener: {
    (eventName: 'onThorControl', listener: (event: ThorControlEvent) => void): NativeSubscription
    (eventName: 'onThorStatus', listener: (event: ThorDisplayStatus) => void): NativeSubscription
  }
  clearSession: () => void
  restoreDraft: (text: string) => void
  setSending: (sending: boolean) => void
  start: (force: boolean) => Promise<ThorDisplayStatus>
  stop: () => void
  updateSession: (state: ThorDisplaySessionState) => void
}

export default requireOptionalNativeModule<ExpoThorDisplayNativeModule>('ExpoThorDisplay')
