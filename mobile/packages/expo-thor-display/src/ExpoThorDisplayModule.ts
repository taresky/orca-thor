import { requireOptionalNativeModule } from 'expo-modules-core'

export type ThorDisplayStatus = {
  activeDisplayId: number | null
  isThor: boolean
  manufacturer: string
  model: string
  secondaryDisplayCount: number
  started: boolean
}

type ExpoThorDisplayNativeModule = {
  addListener: (
    eventName: 'onThorStatus',
    listener: (event: ThorDisplayStatus) => void
  ) => { remove: () => void }
  start: (force: boolean) => Promise<ThorDisplayStatus>
  stop: () => void
}

export default requireOptionalNativeModule<ExpoThorDisplayNativeModule>('ExpoThorDisplay')
