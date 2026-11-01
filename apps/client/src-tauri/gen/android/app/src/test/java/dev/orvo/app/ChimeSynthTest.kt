package dev.orvo.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class ChimeSynthTest {
    private val leave = "1046.5:0:0.6:0.6|783.99:0.12:0.8:0.5"

    @Test
    fun waitsWhileBusyAndGivesUpAtTheTimeout() {
        var busyFor = 3
        var slept = 0L
        assertTrue(waitWhile({ busyFor-- > 0 }, 1000, 50) { slept += it })
        assertEquals(150L, slept)

        slept = 0
        assertEquals(false, waitWhile({ true }, 200, 50) { slept += it })
        assertEquals(200L, slept)

        assertTrue(waitWhile({ false }, 1000, 50) { throw AssertionError("should not wait") })
    }

    @Test
    fun readsTheNotesThePageSends() {
        val notes = ChimeSynth.parse(leave)!!
        assertEquals(2, notes.size)
        assertEquals(783.99, notes[1].freq, 0.001)
        assertEquals(0.12, notes[1].start, 0.001)
    }

    @Test
    fun refusesAnythingThatIsNotAChime() {
        assertNull(ChimeSynth.parse(""))
        assertNull(ChimeSynth.parse("loud"))
        assertNull(ChimeSynth.parse("440:0:1"))
        assertNull(ChimeSynth.parse("20:0:1:1")) // too low a pitch
        assertNull(ChimeSynth.parse("440:0:60:1")) // far too long
        assertNull(ChimeSynth.parse("440:0:1:5")) // too loud
        assertNull(ChimeSynth.parse(List(7) { "440:0:1:1" }.joinToString("|")))
        assertNotNull(ChimeSynth.parse("440:0:1:1"))
    }

    @Test
    fun endsAfterItsLastNoteHasFaded() {
        val notes = ChimeSynth.parse(leave)!!
        val samples = ChimeSynth.render(notes, 1.0)
        val seconds = samples.size.toDouble() / ChimeSynth.SAMPLE_RATE
        assertEquals(0.12 + 0.02 + 0.8 + 0.05, seconds, 0.01)
    }

    @Test
    fun staysWellBelowFullScaleAndFollowsTheVolume() {
        val notes = ChimeSynth.parse(leave)!!
        val peak = { volume: Double -> ChimeSynth.render(notes, volume).maxOf { abs(it.toInt()) } }
        assertTrue(peak(1.0) < Short.MAX_VALUE / 2)
        assertTrue(peak(0.5) < peak(1.0))
        assertEquals(0, peak(0.0))
    }
}
