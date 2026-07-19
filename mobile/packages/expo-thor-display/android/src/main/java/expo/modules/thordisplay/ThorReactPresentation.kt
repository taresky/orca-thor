package expo.modules.thordisplay

import android.app.Presentation
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.Display
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import com.facebook.react.ReactHost
import com.facebook.react.interfaces.fabric.ReactSurface

class ThorReactPresentation(
    context: Context,
    display: Display,
    private val reactHost: ReactHost
) : Presentation(context, display, android.R.style.Theme_DeviceDefault_NoActionBar) {
    companion object {
        private const val COMPONENT_NAME = "OrcaThorSecondary"
    }

    private var surface: ReactSurface? = null
    private var surfaceRootView: View? = null
    private val focusChangeListener =
        ViewTreeObserver.OnGlobalFocusChangeListener { _, nextFocus ->
            configureSecondaryInput(nextFocus)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The secondary surface is part of the active Orca session, not a dismissible dialog.
        // Back is handled by React drawers/panels and must never reveal the lower launcher.
        setCancelable(false)
        // Keep the lower control surface in the same window when the IME opens. Presentation
        // defaults to ADJUST_PAN, which both hides controls and encourages landscape extract UI.
        window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        val nextSurface = reactHost.createSurface(context, COMPONENT_NAME, null)
        val rootView = requireNotNull(nextSurface.view) {
            "ReactHost did not create a view for the Thor secondary surface"
        }
        surface = nextSurface
        surfaceRootView = rootView
        rootView.viewTreeObserver.addOnGlobalFocusChangeListener(focusChangeListener)
        setContentView(
            rootView,
            android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        rootView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        nextSurface.start()
    }

    override fun dismiss() {
        releaseSurface()
        super.dismiss()
    }

    override fun cancel() {
        releaseSurface()
        super.cancel()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val rootView = surfaceRootView
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            rootView?.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true
        ) {
            rootView.windowInsetsController?.hide(WindowInsets.Type.ime())
            return
        }
        // The Presentation is non-cancelable so Back can close the active React drawer/panel
        // without ever dropping the entire lower control surface back to the launcher.
        reactHost.currentReactContext?.emitDeviceEvent("hardwareBackPress", null)
    }

    private fun releaseSurface() {
        surfaceRootView?.viewTreeObserver?.takeIf { it.isAlive }
            ?.removeOnGlobalFocusChangeListener(focusChangeListener)
        surfaceRootView = null
        val currentSurface = surface
        surface = null
        currentSurface?.stop()
        currentSurface?.clear()
        currentSurface?.detach()
    }

    private fun configureSecondaryInput(nextFocus: View?) {
        val editor = nextFocus as? TextView ?: return
        val requiredFlags = EditorInfo.IME_FLAG_NO_FULLSCREEN or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        if (editor.imeOptions and requiredFlags == requiredFlags) {
            return
        }
        editor.imeOptions = editor.imeOptions or requiredFlags
        // Some landscape IMEs decide their extract mode before the React prop commit. Restarting
        // after focus makes the updated EditorInfo authoritative for the active lower-screen field.
        editor.post {
            if (editor.isFocused) {
                val inputMethodManager =
                    context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                inputMethodManager.restartInput(editor)
            }
        }
    }
}
