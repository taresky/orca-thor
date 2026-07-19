package expo.modules.thordisplay

import android.app.Presentation
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Display
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

@Suppress("DEPRECATION")
class ThorPresentation(
    context: Context,
    display: Display,
    private val onAction: (ThorControlAction) -> Unit
) : Presentation(context, display, android.R.style.Theme_DeviceDefault_NoActionBar) {
    companion object {
        // Thor leaves about 275dp above WeType; these values preserve a roomy input
        // and a full-size Send target inside that measured compact viewport.
        private const val IME_COMPACT_HEIGHT_DP = 300
        private const val SEND_BUTTON_WIDTH_DP = 140
    }

    private lateinit var statusLabel: TextView
    private lateinit var targetLabel: TextView
    private lateinit var input: EditText
    private lateinit var sendButton: Button
    private lateinit var keyButtons: List<Button>
    private var state = ThorSessionState()
    private var sending = false
    private val geistTypeface by lazy {
        Typeface.createFromAsset(context.assets, "fonts/Geist-Variable.ttf")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        setContentView(buildContent())
        applyState(state)
    }

    fun applyState(next: ThorSessionState) {
        state = next
        if (!::statusLabel.isInitialized) {
            return
        }

        statusLabel.text = when {
            !next.active -> "Open a terminal on the upper screen"
            sending -> "Sending…"
            else -> when (next.connectionState) {
                ThorConnectionState.CONNECTED -> "Connected"
                ThorConnectionState.CONNECTING -> "Connecting"
                ThorConnectionState.HANDSHAKING -> "Securing connection"
                ThorConnectionState.RECONNECTING -> "Reconnecting"
                ThorConnectionState.AUTH_FAILED -> "Authentication failed"
                ThorConnectionState.DISCONNECTED -> "Offline"
            }
        }
        statusLabel.setTextColor(
            when {
                !next.active -> ThorPalette.textMuted
                sending -> ThorPalette.statusAmber
                next.connectionState == ThorConnectionState.CONNECTED -> ThorPalette.statusGreen
                next.connectionState == ThorConnectionState.AUTH_FAILED -> ThorPalette.statusRed
                next.connectionState == ThorConnectionState.DISCONNECTED -> ThorPalette.textMuted
                else -> ThorPalette.statusAmber
            }
        )
        targetLabel.text = if (next.active) {
            listOf(next.worktreeName, next.terminalTitle)
                .filter { it.isNotBlank() }
                .joinToString("  ·  ")
        } else {
            "Thor controls"
        }

        val enabled = next.active &&
            next.connectionState == ThorConnectionState.CONNECTED &&
            !sending
        input.isEnabled = enabled
        sendButton.isEnabled = enabled
        keyButtons.forEach { it.isEnabled = enabled }
        setButtonEnabledAppearance(sendButton, enabled, primary = true)
        keyButtons.forEach { setButtonEnabledAppearance(it, enabled, primary = false) }
    }

    fun restoreDraft(text: String) {
        if (!::input.isInitialized || text.isEmpty()) {
            return
        }
        val current = input.text?.toString().orEmpty()
        val restored = if (current.isEmpty()) text else "$text\n$current"
        input.setText(restored)
        input.setSelection(restored.length)
        statusLabel.text = "Send failed · text restored"
        statusLabel.setTextColor(ThorPalette.statusAmber)
    }

    fun setSending(next: Boolean) {
        sending = next
        applyState(state)
    }

    private fun buildContent(): View {
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(
                dp(ThorPalette.spacingLg),
                dp(ThorPalette.spacingMd),
                dp(ThorPalette.spacingLg),
                dp(ThorPalette.spacingMd)
            )
            setBackgroundColor(ThorPalette.background)
        }

        val brandLabel = TextView(context).apply {
            text = "ORCA · THOR"
            setTextColor(ThorPalette.textSecondary)
            textSize = ThorPalette.metaTextSize
            typeface = Typeface.create(geistTypeface, Typeface.BOLD)
            letterSpacing = 0.05f
        }
        root.addView(brandLabel, matchWidthWrapHeight())

        targetLabel = TextView(context).apply {
            setTextColor(ThorPalette.textPrimary)
            textSize = ThorPalette.titleTextSize
            typeface = Typeface.create(geistTypeface, Typeface.BOLD)
            maxLines = 1
        }
        root.addView(targetLabel, marginLayoutParams(top = ThorPalette.spacingSm))

        statusLabel = TextView(context).apply {
            textSize = ThorPalette.denseTextSize
            typeface = geistTypeface
        }
        root.addView(
            statusLabel,
            marginLayoutParams(top = ThorPalette.spacingXs, bottom = ThorPalette.spacingMd)
        )

        val composer = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        input = EditText(context).apply {
            hint = "Message or command"
            setHintTextColor(ThorPalette.textMuted)
            setTextColor(ThorPalette.textPrimary)
            typeface = geistTypeface
            background = roundedBackground(
                ThorPalette.panel,
                ThorPalette.border,
                ThorPalette.controlRadius.toFloat()
            )
            setPadding(
                dp(ThorPalette.spacingMd),
                dp(ThorPalette.spacingSm),
                dp(ThorPalette.spacingMd),
                dp(ThorPalette.spacingSm)
            )
            // Why: the lower screen is a thumb keyboard surface; 16sp keeps
            // composed CJK text legible while the surrounding UI uses tokens.
            textSize = 16f
            minLines = 2
            maxLines = 4
            isSingleLine = false
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            setOnEditorActionListener { _, actionId, event ->
                val isSend = actionId == EditorInfo.IME_ACTION_SEND
                val isEnter = event?.keyCode == KeyEvent.KEYCODE_ENTER &&
                    event.action == KeyEvent.ACTION_UP
                if (isSend || isEnter) {
                    submitText()
                    true
                } else {
                    false
                }
            }
        }
        composer.addView(
            input,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        sendButton = createButton("Send", primary = true) { submitText() }
        composer.addView(
            sendButton,
            LinearLayout.LayoutParams(
                dp(SEND_BUTTON_WIDTH_DP),
                LinearLayout.LayoutParams.MATCH_PARENT
            ).apply {
                marginStart = dp(ThorPalette.spacingSm)
            }
        )
        root.addView(composer, matchWidthWrapHeight())

        val firstKeys = listOf(
            KeySpec("Esc", "\u001b"),
            KeySpec("Tab", "\t"),
            KeySpec("↑", "\u001b[A"),
            KeySpec("↓", "\u001b[B")
        )
        val secondKeys = listOf(
            KeySpec("←", "\u001b[D"),
            KeySpec("→", "\u001b[C"),
            KeySpec("Ctrl-C", "\u0003"),
            KeySpec("⌫", "\u007f"),
            KeySpec("Enter", "\r")
        )
        val createdKeys = mutableListOf<Button>()
        val accessoryControls = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
        }
        accessoryControls.addView(
            createKeyRow(firstKeys, createdKeys),
            marginLayoutParams(top = ThorPalette.spacingMd)
        )
        accessoryControls.addView(
            createKeyRow(secondKeys, createdKeys),
            marginLayoutParams(top = ThorPalette.spacingSm)
        )

        val replies = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        listOf("continue", "yes", "no").forEach { reply ->
            val button = createButton(reply, primary = false) {
                onAction(ThorControlAction.Submit(reply))
            }
            createdKeys += button
            replies.addView(button, weightedButtonLayoutParams())
        }
        accessoryControls.addView(replies, marginLayoutParams(top = ThorPalette.spacingSm))

        val keyboardButton = createButton("Show keyboard", primary = false) { showKeyboard() }
        createdKeys += keyboardButton
        accessoryControls.addView(keyboardButton, marginLayoutParams(top = ThorPalette.spacingSm))
        root.addView(accessoryControls, matchWidthWrapHeight())
        keyButtons = createdKeys

        var compactForIme = false
        root.addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ ->
            val shouldCompact = bottom - top < dp(IME_COMPACT_HEIGHT_DP)
            root.post {
                if (shouldCompact == compactForIme) {
                    return@post
                }
                compactForIme = shouldCompact
                val chromeVisibility = if (shouldCompact) View.GONE else View.VISIBLE
                brandLabel.visibility = chromeVisibility
                targetLabel.visibility = chromeVisibility
                statusLabel.visibility = chromeVisibility
                accessoryControls.visibility = chromeVisibility
                root.setPadding(
                    dp(ThorPalette.spacingLg),
                    dp(if (shouldCompact) ThorPalette.spacingSm else ThorPalette.spacingMd),
                    dp(ThorPalette.spacingLg),
                    dp(ThorPalette.spacingMd)
                )
                root.requestLayout()
            }
        }
        return root
    }

    private fun createKeyRow(specs: List<KeySpec>, target: MutableList<Button>): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            specs.forEach { spec ->
                val button = createButton(spec.label, primary = false) {
                    onAction(ThorControlAction.Raw(spec.bytes))
                }
                target += button
                addView(button, weightedButtonLayoutParams())
            }
        }
    }

    private fun createButton(label: String, primary: Boolean, onClick: () -> Unit): Button {
        return Button(context).apply {
            text = label
            textSize = ThorPalette.bodyTextSize
            typeface = geistTypeface
            isAllCaps = false
            minHeight = dp(ThorPalette.minimumTouchTarget)
            setPadding(dp(ThorPalette.spacingSm), 0, dp(ThorPalette.spacingSm), 0)
            setOnClickListener { onClick() }
            setButtonEnabledAppearance(this, enabled = true, primary = primary)
        }
    }

    private fun submitText() {
        if (!state.active || state.connectionState != ThorConnectionState.CONNECTED || sending) {
            return
        }
        val text = input.text?.toString().orEmpty()
        input.text?.clear()
        onAction(ThorControlAction.Submit(text))
        input.requestFocus()
    }

    private fun showKeyboard() {
        if (!input.isEnabled) {
            return
        }
        input.requestFocus()
        input.post {
            val keyboard = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun setButtonEnabledAppearance(button: Button, enabled: Boolean, primary: Boolean) {
        button.alpha = if (enabled) 1f else 0.45f
        button.setTextColor(
            if (primary) ThorPalette.onSurfaceBright else ThorPalette.textPrimary
        )
        button.background = roundedBackground(
            if (primary) ThorPalette.surfaceBright else ThorPalette.raised,
            if (primary) ThorPalette.surfaceBright else ThorPalette.border,
            ThorPalette.controlRadius.toFloat()
        )
    }

    private fun roundedBackground(fill: Int, stroke: Int, radiusDp: Float): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(fill)
            setStroke(dp(1), stroke)
            cornerRadius = dp(radiusDp.toInt()).toFloat()
        }
    }

    private fun matchWidthWrapHeight() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    )

    private fun marginLayoutParams(top: Int = 0, bottom: Int = 0) = matchWidthWrapHeight().apply {
        topMargin = dp(top)
        bottomMargin = dp(bottom)
    }

    private fun weightedButtonLayoutParams() = LinearLayout.LayoutParams(
        0,
        dp(ThorPalette.minimumTouchTarget),
        1f
    ).apply {
        marginStart = dp(ThorPalette.spacingXs)
        marginEnd = dp(ThorPalette.spacingXs)
    }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

    private data class KeySpec(val label: String, val bytes: String)
}
