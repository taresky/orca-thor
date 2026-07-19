package expo.modules.thordisplay

enum class ThorConnectionState(val wireValue: String) {
    CONNECTING("connecting"),
    HANDSHAKING("handshaking"),
    CONNECTED("connected"),
    DISCONNECTED("disconnected"),
    RECONNECTING("reconnecting"),
    AUTH_FAILED("auth-failed");

    companion object {
        fun fromWire(value: String?): ThorConnectionState =
            values().firstOrNull { it.wireValue == value } ?: DISCONNECTED
    }
}

data class ThorSessionState(
    val active: Boolean = false,
    val connectionState: ThorConnectionState = ThorConnectionState.DISCONNECTED,
    val terminalTitle: String = "",
    val worktreeName: String = ""
)

sealed class ThorControlAction {
    data class Submit(val text: String) : ThorControlAction()
    data class Raw(val text: String) : ThorControlAction()
}

data class ThorDisplayStatus(
    val activeDisplayId: Int?,
    val isThor: Boolean,
    val manufacturer: String,
    val model: String,
    val secondaryDisplayCount: Int,
    val started: Boolean
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "activeDisplayId" to activeDisplayId,
        "isThor" to isThor,
        "manufacturer" to manufacturer,
        "model" to model,
        "secondaryDisplayCount" to secondaryDisplayCount,
        "started" to started
    )
}
