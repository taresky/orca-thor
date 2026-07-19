package expo.modules.thordisplay

import android.graphics.Color

// Presentation cannot import React Native tokens; these mirror mobile-theme.ts,
// with lower-screen ergonomic exceptions documented at their use sites.
object ThorPalette {
    const val spacingXs = 4
    const val spacingSm = 8
    const val spacingMd = 12
    const val spacingLg = 16
    const val controlRadius = 6
    const val minimumTouchTarget = 44
    const val metaTextSize = 12f
    const val denseTextSize = 13f
    const val bodyTextSize = 14f
    const val titleTextSize = 18f

    val background = Color.parseColor("#111111")
    val panel = Color.parseColor("#1a1a1a")
    val raised = Color.parseColor("#242424")
    val border = Color.parseColor("#2a2a2a")
    val textPrimary = Color.parseColor("#e0e0e0")
    val textSecondary = Color.parseColor("#888888")
    val textMuted = Color.parseColor("#555555")
    val surfaceBright = Color.parseColor("#f5f5f5")
    val onSurfaceBright = Color.parseColor("#111111")
    val statusGreen = Color.parseColor("#22c55e")
    val statusAmber = Color.parseColor("#f59e0b")
    val statusRed = Color.parseColor("#ef4444")
}
