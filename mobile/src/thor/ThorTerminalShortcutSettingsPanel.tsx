import { useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue
} from 'react-native-reanimated'
import { ChevronLeft } from 'lucide-react-native'
import { TerminalShortcutSettings } from '../components/TerminalShortcutSettings'
import { colors, spacing } from '../theme/mobile-theme'

export function ThorTerminalShortcutSettingsPanel({
  onBack
}: {
  onBack: () => void
}): React.JSX.Element {
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollOffsetY = useSharedValue(0)
  const scrollContentHeight = useSharedValue(0)
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffsetY.value = event.contentOffset.y
  })
  const handleDragActiveChange = useCallback(
    (active: boolean) => scrollRef.current?.setNativeProps({ scrollEnabled: !active }),
    [scrollRef]
  )

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityLabel="Back">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.title}>Terminal shortcuts</Text>
      </View>
      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => {
          scrollContentHeight.value = height
        }}
      >
        <TerminalShortcutSettings
          scrollRef={scrollRef}
          scrollOffsetY={scrollOffsetY}
          scrollContentHeight={scrollContentHeight}
          onDragActiveChange={handleDragActiveChange}
        />
      </Animated.ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBase, paddingHorizontal: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  content: { paddingBottom: spacing.xl }
})
