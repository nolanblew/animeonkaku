package com.takeya.animeongaku.data.local

import kotlin.math.pow

/** Analysis metadata for one exact audio asset; the client only applies server-selected attenuation. */
data class LoudnessProfile(
    val integratedLufs: Double? = null,
    val truePeakDbtp: Double? = null,
    val loudnessRangeLu: Double? = null,
    val gainDb: Double? = null,
    val policyVersion: Int? = null,
    val state: String? = null
) {
    /** Unknown, failed, malformed, and boost requests always play at unity. */
    fun attenuationGainDb(): Double = gainDb
        ?.takeIf { state.equals(STATE_READY, ignoreCase = true) && it.isFinite() }
        ?.coerceIn(MIN_GAIN_DB, 0.0)
        ?: 0.0

    fun playerVolume(): Float = dbToLinearVolume(attenuationGainDb())

    companion object {
        const val STATE_READY = "READY"
        private const val MIN_GAIN_DB = -60.0
    }
}

internal fun dbToLinearVolume(gainDb: Double): Float =
    10.0.pow((gainDb.takeIf { it.isFinite() } ?: 0.0).coerceIn(-60.0, 0.0) / 20.0).toFloat()
