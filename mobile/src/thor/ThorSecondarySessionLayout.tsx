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
  // Fabric can preserve the previous flex measurement when a secondary root swaps
  // chrome + dock for a single panel. Pin the replacement to the presentation's
  // bounds so embedded panels receive a concrete width and height on the same frame.
  fullscreenContext: {
    ...StyleSheet.absoluteFillObject
  }
})
