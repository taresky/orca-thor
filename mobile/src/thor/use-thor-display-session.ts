import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import {
  addThorStatusListener,
  isThorDisplayModuleAvailable,
  startThorDisplay,
  stopThorDisplay
} from '@orca/expo-thor-display'
import { refreshThorSecondaryContent } from './thor-secondary-content-store'

export function useThorDisplaySession(): boolean {
  const [secondaryActive, setSecondaryActive] = useState(false)

  useEffect(() => {
    if (!isThorDisplayModuleAvailable()) {
      return
    }
    let disposed = false
    const subscription = addThorStatusListener((status) => {
      if (!disposed) {
        setSecondaryActive(status.started)
      }
    })
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        requestAnimationFrame(refreshThorSecondaryContent)
      }
    })
    void startThorDisplay(__DEV__)
      .then((status) => {
        if (!disposed) {
          setSecondaryActive(status?.started === true)
        }
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      appStateSubscription.remove()
      subscription.remove()
      stopThorDisplay()
    }
  }, [])

  return secondaryActive
}
