package expo.modules.thordisplay

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
