import { useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  getThorSecondaryContextSnapshot,
  subscribeThorSecondaryContext
} from './thor-secondary-context-store'

export function ThorSecondaryContextSlot(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    subscribeThorSecondaryContext,
    getThorSecondaryContextSnapshot,
    getThorSecondaryContextSnapshot
  )

  return <View style={styles.root}>{snapshot.content}</View>
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }
})
