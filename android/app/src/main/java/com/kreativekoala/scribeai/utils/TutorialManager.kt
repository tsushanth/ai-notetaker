//utils/TutorialManager.kt

package com.kreativekoala.scribeai.utils

import android.content.Context
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.local.NoteCacheRepository as LocalNoteRepository
import com.kreativekoala.scribeai.data.models.AIContent // Use existing model
import com.kreativekoala.scribeai.data.models.CreateNoteRequest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Manages the tutorial note for new users
 * Seeds tutorial on first launch with all AI content pre-generated
 */
class TutorialManager(
    private val context: Context,
    private val localRepository: LocalNoteRepository,
    private val authManager: AuthManager? = null
) {

    companion object {
        private const val TAG = "TutorialManager"
        private const val DATASTORE_NAME = "tutorial_prefs"
        private val TUTORIAL_SEEDED_KEY = booleanPreferencesKey("tutorial_seeded")
        // Server assigns its own UUID for the tutorial note (the client-side
        // sentinel id is global and would collide on notes_pkey). Stored so
        // server-dependent features (chat) can be routed to the real server id.
        private val TUTORIAL_SERVER_ID_KEY = stringPreferencesKey("tutorial_server_id")

        private val Context.tutorialDataStore: DataStore<Preferences> by preferencesDataStore(
            name = DATASTORE_NAME
        )

        /**
         * Static read of the tutorial server id from anywhere. Lets non-Hilt
         * code (e.g. ViewModels without a TutorialManager dependency) translate
         * the sentinel tutorial id to the real server-side id before calling
         * server-dependent endpoints like chat.
         */
        suspend fun getServerId(context: Context): String? {
            return try {
                context.applicationContext.tutorialDataStore.data
                    .map { it[TUTORIAL_SERVER_ID_KEY] }
                    .first()
            } catch (e: Exception) {
                Log.e(TAG, "Static getServerId error", e)
                null
            }
        }
    }

    /**
     * Check if tutorial has been seeded for this user
     */
    suspend fun isTutorialSeeded(userId: String): Boolean {
        return try {
            context.tutorialDataStore.data.map { preferences ->
                preferences[TUTORIAL_SEEDED_KEY] ?: false
            }.first()
        } catch (e: Exception) {
            Log.e(TAG, "Error checking tutorial status", e)
            false
        }
    }

    /**
     * Seed tutorial note for new user
     * Call this after successful signup/login
     */
    suspend fun seedTutorialIfNeeded(userId: String) {
        try {
            val seeded = isTutorialSeeded(userId)
            val existingTutorial = localRepository.getNoteById(TutorialContent.TUTORIAL_ID)
            val serverIdMissing = getTutorialServerId() == null

            if (seeded && existingTutorial != null && !serverIdMissing) {
                Log.d(TAG, "Tutorial already seeded + server id present for user: $userId")
                return
            }

            // Build the local note (idempotent — same sentinel id every time)
            val tutorialNote = existingTutorial ?: TutorialContent.createTutorialNote(userId)

            if (existingTutorial == null) {
                Log.d(TAG, "Seeding tutorial note for new user: $userId")
                localRepository.addNote(userId, tutorialNote)
            } else {
                Log.d(TAG, "Tutorial exists locally; retrying server sync (server id missing=$serverIdMissing)")
            }

            // Sync to backend if we don't already have a server id (covers both
            // fresh seeds and the migration case where an older install seeded
            // locally before the server-side sentinel fix landed and never
            // captured a real server id).
            if (serverIdMissing) {
                syncTutorialToBackend(tutorialNote)
            }

            markTutorialAsSeeded()
            Log.d(TAG, "✅ Tutorial seed flow complete")
        } catch (e: Exception) {
            Log.e(TAG, "Error seeding tutorial", e)
        }
    }

    /**
     * Mark tutorial as seeded
     */
    private suspend fun markTutorialAsSeeded() {
        try {
            context.tutorialDataStore.edit { preferences ->
                preferences[TUTORIAL_SEEDED_KEY] = true
            }
            Log.d(TAG, "Tutorial marked as seeded")
        } catch (e: Exception) {
            Log.e(TAG, "Error marking tutorial as seeded", e)
        }
    }

    /**
     * Reset tutorial seeding (for testing)
     */
    suspend fun resetTutorial() {
        try {
            context.tutorialDataStore.edit { preferences ->
                preferences.remove(TUTORIAL_SEEDED_KEY)
                preferences.remove(TUTORIAL_SERVER_ID_KEY)
            }
            Log.d(TAG, "Tutorial reset")
        } catch (e: Exception) {
            Log.e(TAG, "Error resetting tutorial", e)
        }
    }

    /**
     * Sync tutorial note to backend so AI features work on it.
     * Uses the same UUID so chat/mindmap/podcast can find it server-side.
     */
    private suspend fun syncTutorialToBackend(note: com.kreativekoala.scribeai.data.models.Note) {
        try {
            val token = authManager?.getFreshToken() ?: run {
                Log.w(TAG, "No auth token available, skipping backend sync")
                return
            }

            // Don't send the sentinel id — server treats it as "no id" anyway
            // and would just generate one server-side; sending it costs nothing
            // but makes intent clearer.
            val request = CreateNoteRequest(
                id = null,
                title = note.title,
                content = note.content,
                sourceType = note.sourceType ?: "tutorial",
                metadata = mapOf("isTutorial" to true, "version" to "1.0")
            )

            val response = RetrofitClient.apiService.createNote("Bearer $token", request)

            if (response.isSuccessful) {
                val serverId = response.body()?.data?.id
                if (serverId != null) {
                    saveTutorialServerId(serverId)
                    Log.d(TAG, "✅ Tutorial note synced to backend: serverId=$serverId")
                } else {
                    Log.w(TAG, "Backend sync succeeded but response had no id")
                }
            } else {
                Log.w(TAG, "Backend sync failed (${response.code()}): ${response.errorBody()?.string()}")
            }
        } catch (e: Exception) {
            // Non-fatal: tutorial still works locally, backend features will fail gracefully
            Log.w(TAG, "Failed to sync tutorial to backend (non-fatal)", e)
        }
    }

    /**
     * The server-side id of the tutorial note for this install. Lives in
     * DataStore. Returns null if the tutorial has never been synced
     * successfully (e.g. offline-only install).
     */
    suspend fun getTutorialServerId(): String? {
        return try {
            context.tutorialDataStore.data.map { it[TUTORIAL_SERVER_ID_KEY] }.first()
        } catch (e: Exception) {
            Log.e(TAG, "Error reading tutorial server id", e)
            null
        }
    }

    private suspend fun saveTutorialServerId(serverId: String) {
        try {
            context.tutorialDataStore.edit { it[TUTORIAL_SERVER_ID_KEY] = serverId }
        } catch (e: Exception) {
            Log.e(TAG, "Error saving tutorial server id", e)
        }
    }

    /**
     * Check if a note is the tutorial note
     */
    fun isTutorialNote(noteId: String): Boolean {
        return noteId == TutorialContent.TUTORIAL_ID
    }
}