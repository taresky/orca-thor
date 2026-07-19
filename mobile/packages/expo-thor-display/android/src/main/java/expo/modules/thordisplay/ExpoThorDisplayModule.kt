package expo.modules.thordisplay

import android.os.Handler
import android.os.Looper
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoThorDisplayModule : Module() {
    companion object {
        private const val ON_CONTROL_EVENT = "onThorControl"
    }

    private var controller: ThorDisplayController? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun definition() = ModuleDefinition {
        Name("ExpoThorDisplay")
        Events(ON_CONTROL_EVENT)

        AsyncFunction("start") { force: Boolean, promise: Promise ->
            val activity = appContext.currentActivity
            val context = appContext.reactContext?.applicationContext
            if (activity == null || context == null) {
                promise.reject("ERR_THOR_ACTIVITY", "The Android activity is not available", null)
                return@AsyncFunction
            }
            runOnMain {
                try {
                    val activeController = controller ?: ThorDisplayController(context) { action ->
                        when (action) {
                            is ThorControlAction.Submit -> sendEvent(
                                ON_CONTROL_EVENT,
                                bundleOf("kind" to "submit", "text" to action.text)
                            )
                            is ThorControlAction.Raw -> sendEvent(
                                ON_CONTROL_EVENT,
                                bundleOf("kind" to "raw", "text" to action.text)
                            )
                        }
                    }.also { controller = it }
                    promise.resolve(activeController.start(activity, force).toMap())
                } catch (error: Exception) {
                    promise.reject("ERR_THOR_START", error.message, error)
                }
            }
        }

        Function("updateSession") { state: Map<String, Any?> ->
            val next = ThorSessionState(
                active = state["active"] as? Boolean ?: false,
                connectionState = ThorConnectionState.fromWire(state["connectionState"] as? String),
                terminalTitle = state["terminalTitle"] as? String ?: "",
                worktreeName = state["worktreeName"] as? String ?: ""
            )
            runOnMain {
                controller?.updateSession(next)
            }
        }

        Function("clearSession") {
            runOnMain {
                controller?.clearSession()
            }
        }

        Function("restoreDraft") { text: String ->
            runOnMain {
                controller?.restoreDraft(text)
            }
        }

        Function("setSending") { sending: Boolean ->
            runOnMain {
                controller?.setSending(sending)
            }
        }

        Function("stop") {
            runOnMain {
                controller?.stop()
            }
        }

        OnDestroy {
            // Why: Expo can destroy the module after the Activity reference is
            // gone; always unregister the DisplayListener to avoid retaining it.
            runOnMain {
                controller?.stop()
                controller = null
            }
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }
}
