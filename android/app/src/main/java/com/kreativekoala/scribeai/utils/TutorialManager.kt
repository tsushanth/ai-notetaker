//utils/TutorialManager.kt

package com.kreativekoala.scribeai.utils

import android.content.Context
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
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

        private val Context.tutorialDataStore: DataStore<Preferences> by preferencesDataStore(
            name = DATASTORE_NAME
        )
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
            // Check if already seeded
            if (isTutorialSeeded(userId)) {
                Log.d(TAG, "Tutorial already seeded for user: $userId")
                return
            }

            // Check if tutorial note already exists in cache
            val existingTutorial = localRepository.getNoteById(TutorialContent.TUTORIAL_ID)
            if (existingTutorial != null) {
                Log.d(TAG, "Tutorial note already exists in cache")
                markTutorialAsSeeded()
                return
            }

            Log.d(TAG, "Seeding tutorial note for new user: $userId")

            // Create tutorial note
            val tutorialNote = TutorialContent.createTutorialNote(userId)

            // Add to local cache
            localRepository.addNote(userId, tutorialNote)

            // Sync tutorial note to backend so AI features (chat, mindmap, podcast) work
            syncTutorialToBackend(tutorialNote)

            // Mark as seeded
            markTutorialAsSeeded()

            Log.d(TAG, "✅ Tutorial note seeded successfully")

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

            val request = CreateNoteRequest(
                id = note.id,
                title = note.title,
                content = note.content,
                sourceType = note.sourceType ?: "tutorial",
                metadata = mapOf("isTutorial" to true, "version" to "1.0")
            )

            val response = RetrofitClient.apiService.createNote("Bearer $token", request)

            if (response.isSuccessful) {
                Log.d(TAG, "✅ Tutorial note synced to backend: ${note.id}")
            } else {
                Log.w(TAG, "Backend sync failed (${response.code()}): ${response.errorBody()?.string()}")
            }
        } catch (e: Exception) {
            // Non-fatal: tutorial still works locally, backend features will fail gracefully
            Log.w(TAG, "Failed to sync tutorial to backend (non-fatal)", e)
        }
    }

    /**
     * Check if a note is the tutorial note
     */
    fun isTutorialNote(noteId: String): Boolean {
        return noteId == TutorialContent.TUTORIAL_ID
    }
}