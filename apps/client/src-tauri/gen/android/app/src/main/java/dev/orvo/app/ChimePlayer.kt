package dev.orvo.app

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin

/** One bell note, as in `chime.ts`: pitch in hertz, seconds until it starts, seconds it takes to fade, and its level. */
data class ChimeNote(val freq: Double, val start: Double, val decay: Double, val gain: Double)

/** Draws the chime as samples, the same way `chime.ts` builds it from oscillators and gain ramps. */
object ChimeSynth {
    const val SAMPLE_RATE = 44100
    private const val ATTACK = 0.02
    private const val SILENCE = 0.0001
    private const val OCTAVE_LEVEL = 0.18

    /** Peak level of the loudest note before the volume setting. Higher than the web's, which the call's volume scales. */
    private const val MASTER = 0.3
    private const val TAIL = 0.05

    fun render(notes: List<ChimeNote>, volume: Double): ShortArray {
        val length = notes.maxOfOrNull { it.start + ATTACK + it.decay + TAIL } ?: return ShortArray(0)
        val samples = ShortArray((length * SAMPLE_RATE).toInt())
        for (i in samples.indices) {
            val t = i.toDouble() / SAMPLE_RATE
            var sum = 0.0
            for (note in notes) {
                val dt = t - note.start
                if (dt < 0 || dt > ATTACK + note.decay) continue
                val peak = volume * MASTER * note.gain
                val level = if (dt < ATTACK) peak * dt / ATTACK else peak * (SILENCE / max(peak, SILENCE)).pow((dt - ATTACK) / note.decay)
                sum += level * (sin(2 * PI * note.freq * dt) + OCTAVE_LEVEL * sin(2 * PI * 2 * note.freq * dt))
            }
            samples[i] = (sum.coerceIn(-1.0, 1.0) * Short.MAX_VALUE).toInt().toShort()
        }
        return samples
    }

    /**
     * Reads the notes the page sends, "freq:start:decay:gain" separated by "|". Anything outside what a chime needs is
     * refused, because activity pages run in the same web view and can call this too.
     */
    fun parse(text: String): List<ChimeNote>? {
        val notes = text.split("|").map { part ->
            val v = part.split(":").map { it.toDoubleOrNull() ?: return null }
            if (v.size != 4) return null
            ChimeNote(v[0], v[1], v[2], v[3])
        }
        val sane = notes.size in 1..6 && notes.all {
            it.freq in 100.0..5000.0 && it.start in 0.0..2.0 && it.decay in 0.05..3.0 && it.gain in 0.0..1.0
        }
        return if (sane) notes else null
    }
}

/**
 * Plays the join, leave and activity chimes on the notification volume. In a call the web view's own audio follows the
 * call volume, which can be much quieter or louder than the media volume, so the same chime came out at different
 * levels. Here it is always on the volume the person set for notifications.
 */
class ChimePlayer {
    private val main = Handler(Looper.getMainLooper())
    private var playing = 0

    @JavascriptInterface
    fun playChime(notes: String, volume: Double): Boolean {
        val parsed = ChimeSynth.parse(notes) ?: return false
        if (playing >= MAX_AT_ONCE) return false
        val pcm = ChimeSynth.render(parsed, volume.coerceIn(0.0, 1.0))
        if (pcm.isEmpty()) return false
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(ChimeSynth.SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(pcm.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        track.write(pcm, 0, pcm.size)
        track.play()
        synchronized(this) { playing++ }
        main.postDelayed({
            track.release()
            synchronized(this) { playing-- }
        }, pcm.size * 1000L / ChimeSynth.SAMPLE_RATE + 200)
        return true
    }

    private companion object {
        const val MAX_AT_ONCE = 4
    }
}
