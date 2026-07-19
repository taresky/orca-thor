import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme/mobile-theme'

export function ThorSecondarySessionLayout({
  chrome,
  context,
  dock,
  overlays,
  contextFullscreen = false
}: {
  chrome: ReactNode
  context: ReactNode
  dock: ReactNode
  overlays?: ReactNode
  contextFullscreen?: boolean
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      {contextFullscreen ? (
        <View style={styles.fullscreenContext}>{context}</View>
      ) : (
        <>
          {chrome}
          <View style={styles.context}>{context}</View>
          {dock}
        </>
      )}
      {overlays}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBase },
  context: { flex: 1, minHeight: 0 },
  // Why: Fabric may retain the prior flex measurement during a secondary-root swap;
  // pin the replacement so panels receive concrete bounds in the same frame.
  fullscreenContext: {
    ...StyleSheet.absoluteFillObject
  }
})
