package com.kreativekoala.scribeai.recording

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/** Reads the real AndroidManifest.xml source: a missing permission or service type would break recording on Android 14+. */
class RecordingManifestTest {
    private val ns = "http://schemas.android.com/apk/res/android"

    private fun manifest(): Element {
        val f = listOf(File("src/main/AndroidManifest.xml"), File("app/src/main/AndroidManifest.xml")).first { it.exists() }
        val dbf = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        return dbf.newDocumentBuilder().parse(f).documentElement
    }

    private fun permissions(m: Element): Set<String> {
        val nodes = m.getElementsByTagName("uses-permission")
        return (0 until nodes.length).map { (nodes.item(it) as Element).getAttributeNS(ns, "name") }.toSet()
    }

    private fun recordingService(m: Element): Element {
        val nodes = m.getElementsByTagName("service")
        val s = (0 until nodes.length).map { nodes.item(it) as Element }.firstOrNull { it.getAttributeNS(ns, "name") == ".recording.RecordingService" }
        assertNotNull("RecordingService must be declared", s)
        return s!!
    }

    @Test
    fun foregroundServicePermissionsAreDeclared() {
        val p = permissions(manifest())
        listOf(
            "android.permission.RECORD_AUDIO",
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.FOREGROUND_SERVICE_MICROPHONE",
            "android.permission.POST_NOTIFICATIONS"
        ).forEach { assertTrue("missing $it", it in p) }
    }

    @Test
    fun serviceIsAMicrophoneForegroundServiceAndNotExported() {
        val s = recordingService(manifest())
        assertEquals("microphone", s.getAttributeNS(ns, "foregroundServiceType"))
        assertEquals("false", s.getAttributeNS(ns, "exported"))
    }

    @Test
    fun noWakeLockOrBackgroundOnlyPermissionsWereAdded() {
        val p = permissions(manifest())
        // A wake lock is only added if a device test shows the recorder needs one (Play vitals flag long partial wake locks).
        assertFalse("android.permission.WAKE_LOCK" in p)
        assertFalse("android.permission.FOREGROUND_SERVICE_DATA_SYNC" in p)
    }

    @Test
    fun theServiceClassNameMatchesTheCode() {
        assertEquals("com.kreativekoala.scribeai.recording.RecordingService", RecordingService::class.java.name)
    }
}
