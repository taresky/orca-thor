package expo.modules.thordisplay

import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display

class ThorDisplayController(
    private val applicationContext: Context,
    private val onAction: (ThorControlAction) -> Unit
) : DisplayManager.DisplayListener {
    private val displayManager =
        applicationContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    private var activity: Activity? = null
    private var force = false
    private var listening = false
    private var presentation: ThorPresentation? = null
    private var state = ThorSessionState()

    fun start(nextActivity: Activity, forceOnNonThor: Boolean): ThorDisplayStatus {
        activity = nextActivity
        force = forceOnNonThor
        if (!listening) {
            displayManager.registerDisplayListener(this, null)
            listening = true
        }
        refreshPresentation()
        return status()
    }

    fun stop() {
        presentation?.dismiss()
        presentation = null
        activity = null
        if (listening) {
            displayManager.unregisterDisplayListener(this)
            listening = false
        }
    }

    fun updateSession(next: ThorSessionState) {
        state = next
        presentation?.applyState(next)
    }

    fun clearSession() {
        updateSession(ThorSessionState())
    }

    fun restoreDraft(text: String) {
        presentation?.restoreDraft(text)
    }

    fun setSending(sending: Boolean) {
        presentation?.setSending(sending)
    }

    override fun onDisplayAdded(displayId: Int) {
        activity?.runOnUiThread { refreshPresentation() }
    }

    override fun onDisplayRemoved(displayId: Int) {
        activity?.runOnUiThread { refreshPresentation() }
    }

    override fun onDisplayChanged(displayId: Int) {
        activity?.runOnUiThread { refreshPresentation() }
    }

    private fun refreshPresentation() {
        val currentActivity = activity ?: return
        if (!force && !isThorDevice()) {
            presentation?.dismiss()
            presentation = null
            return
        }

        val target = secondaryDisplays(currentActivity).firstOrNull()
        if (target == null) {
            presentation?.dismiss()
            presentation = null
            return
        }
        if (presentation?.display?.displayId == target.displayId && presentation?.isShowing == true) {
            presentation?.applyState(state)
            return
        }

        presentation?.dismiss()
        presentation = ThorPresentation(currentActivity, target, onAction).also {
            it.show()
            it.applyState(state)
        }
    }

    private fun status(): ThorDisplayStatus {
        val currentActivity = activity
        val secondary = if (currentActivity == null) emptyList() else secondaryDisplays(currentActivity)
        return ThorDisplayStatus(
            activeDisplayId = presentation?.display?.displayId,
            isThor = isThorDevice(),
            manufacturer = Build.MANUFACTURER.orEmpty(),
            model = Build.MODEL.orEmpty(),
            secondaryDisplayCount = secondary.size,
            started = presentation?.isShowing == true
        )
    }

    private fun secondaryDisplays(currentActivity: Activity): List<Display> {
        val primaryId = currentActivity.display?.displayId ?: Display.DEFAULT_DISPLAY
        val presentationDisplays =
            displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).toList()
        val candidates = if (presentationDisplays.isNotEmpty()) {
            presentationDisplays
        } else {
            displayManager.displays.toList()
        }
        return candidates.filter { it.displayId != primaryId && it.state != Display.STATE_OFF }
    }

    private fun isThorDevice(): Boolean {
        val model = Build.MODEL.orEmpty().lowercase()
        val device = Build.DEVICE.orEmpty().lowercase()
        val product = Build.PRODUCT.orEmpty().lowercase()
        // Why: Thor firmware builds have shipped with more than one manufacturer
        // spelling; the product/model/device identity is the stable signal.
        return listOf(model, device, product).any { it.contains("thor") }
    }
}
