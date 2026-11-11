package com.kreativekoala.scribeai.security

import com.google.gson.Gson
import com.kreativekoala.scribeai.data.models.SubscriptionSyncRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Guards for what the release build is allowed to do on the network and which permissions it declares.
 * They read the real source files, so a future edit that re-opens cleartext, user CAs or READ_MEDIA_* fails here.
 */
class ReleaseNetworkAndPermissionPolicyTest {

    // Gradle runs unit tests with the app module as the working directory; tolerate the repo root too.
    private fun appFile(path: String): File =
        listOf(File(path), File("app/$path"), File("android/app/$path")).firstOrNull { it.exists() }
            ?: error("cannot find $path from ${File(".").absolutePath}")

    private fun parse(f: File): Element =
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement

    private fun Element.descendants(tag: String): List<Element> {
        val out = ArrayList<Element>()
        val list = getElementsByTagName(tag)
        for (i in 0 until list.length) (list.item(i) as? Element)?.let { out.add(it) }
        return out
    }

    // ---- network security config -----------------------------------------------------------------------

    @Test
    fun releaseConfigIsHttpsOnlyAndTrustsSystemCasOnly() {
        val root = parse(appFile("src/main/res/xml/network_security_config.xml"))
        val base = root.descendants("base-config").single()
        assertEquals("false", base.getAttribute("cleartextTrafficPermitted"))
        // No domain exception may re-enable cleartext.
        for (d in root.descendants("domain-config")) assertEquals("false", d.getAttribute("cleartextTrafficPermitted"))
        // Only system trust anchors, nowhere in the file (no user-installed certificates, no debug-overrides).
        val sources = root.descendants("certificates").map { it.getAttribute("src") }
        assertTrue(sources.isNotEmpty())
        assertTrue("unexpected trust anchors $sources", sources.all { it == "system" })
        assertTrue(root.descendants("debug-overrides").isEmpty())
    }

    @Test
    fun developmentRelaxationsLiveOnlyInTheDebugSourceSet() {
        val debug = parse(appFile("src/debug/res/xml/network_security_config.xml"))
        val certs = debug.descendants("certificates").map { it.getAttribute("src") }
        assertTrue("debug config is the place for user CAs", certs.contains("user"))
    }

    @Test
    fun manifestPointsAtTheConfigAndDoesNotForceCleartext() {
        val app = parse(appFile("src/main/AndroidManifest.xml")).descendants("application").single()
        assertEquals("@xml/network_security_config", app.getAttributeNS("http://schemas.android.com/apk/res/android", "networkSecurityConfig").ifEmpty { app.getAttribute("android:networkSecurityConfig") })
        assertFalse(app.getAttribute("android:usesCleartextTraffic") == "true")
    }

    @Test
    fun noSourceFileContainsAnHttpUrl() {
        // Every host the app contacts is https. A literal http:// URL in Kotlin/Java source would be dead at runtime
        // under the release config, so it must not be introduced.
        val offenders = appFile("src/main/java").walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.extension == "java") }
            .flatMap { f -> f.readLines().mapIndexedNotNull { i, line -> if (Regex("""http://[A-Za-z0-9]""").containsMatchIn(line)) "${f.name}:${i + 1}: ${line.trim()}" else null } }
            .toList()
        assertTrue("cleartext URLs in source: $offenders", offenders.isEmpty())
    }

    // ---- permissions ---------------------------------------------------------------------------------------

    @Test
    fun noReadMediaPermissionIsDeclared() {
        val names = parse(appFile("src/main/AndroidManifest.xml")).descendants("uses-permission").map { it.getAttribute("android:name") }
        assertTrue("READ_MEDIA_* declared: $names", names.none { it.startsWith("android.permission.READ_MEDIA_") })
    }

    @Test
    fun audioIsNeverImportedFromSharedStorage() {
        // If an audio import feature is ever added it must use ACTION_OPEN_DOCUMENT / GetContent, not a media permission.
        val hits = appFile("src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { Regex("""MediaStore\.Audio|READ_MEDIA_AUDIO""").containsMatchIn(it.readText()) }
            .map { it.name }.toList()
        assertTrue("audio read from shared storage in $hits", hits.isEmpty())
    }

    // ---- android id -----------------------------------------------------------------------------------------

    @Test
    fun subscriptionSyncCarriesNoDeviceIdentifier() {
        val json = Gson().toJson(SubscriptionSyncRequest(productId = "scribe_ai_monthly", status = "active", transactionId = "GPA.1"))
        assertFalse(json, json.contains("deviceId", ignoreCase = true))
        assertFalse(json, json.contains("android", ignoreCase = true) && json.contains("android_"))
        assertEquals(
            setOf("productId", "platform", "status", "originalTransactionId", "transactionId", "expirationDate", "purchaseDate", "isTrial", "trialEndDate", "autoRenewEnabled", "priceAmount", "priceCurrency").filter { json.contains("\"$it\"") }.toSet(),
            setOf("productId", "platform", "status", "transactionId", "isTrial", "autoRenewEnabled")
        )
    }

    @Test
    fun theAppNeverReadsTheAndroidId() {
        val hits = appFile("src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains("ANDROID_ID") }
            .map { it.name }.toList()
        assertTrue("ANDROID_ID read in $hits", hits.isEmpty())
    }
}
