package expo.modules.thordisplay

import android.app.Presentation
import android.content.Context
import android.os.Bundle
import android.view.Display
import android.view.View
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val nextSurface = reactHost.createSurface(context, COMPONENT_NAME, null)
        val rootView = requireNotNull(nextSurface.view) {
            "ReactHost did not create a view for the Thor secondary surface"
        }
        surface = nextSurface
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

    private fun releaseSurface() {
        val currentSurface = surface
        surface = null
        currentSurface?.stop()
        currentSurface?.clear()
        currentSurface?.detach()
    }
}
