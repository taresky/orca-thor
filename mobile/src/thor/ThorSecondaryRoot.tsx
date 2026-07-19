import { useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { colors } from '../theme/mobile-theme'
import {
  getThorSecondaryContentSnapshot,
  subscribeThorSecondaryContent
} from './thor-secondary-content-store'

export const THOR_SECONDARY_COMPONENT_NAME = 'OrcaThorSecondary'

export function ThorSecondaryRoot(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    subscribeThorSecondaryContent,
    getThorSecondaryContentSnapshot,
    getThorSecondaryContentSnapshot
  )

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.root}>{snapshot.content}</View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBase }
})
