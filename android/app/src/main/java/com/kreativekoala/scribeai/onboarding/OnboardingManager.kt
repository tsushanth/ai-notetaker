package com.kreativekoala.scribeai.onboarding

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.OnboardingPreferencesRequest
import com.kreativekoala.scribeai.utils.AnalyticsService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * User types for onboarding
 */
enum class UserType(val displayName: String, val value: String) {
    UNDERGRADUATE_STUDENT("Undergraduate Student", "undergraduate_student"),
    HIGH_SCHOOL_STUDENT("High School Student", "high_school_student"),
    MIDDLE_SCHOOL_STUDENT("Middle School Student", "middle_school_student"),
    GRADUATE_STUDENT("Graduate Student", "graduate_student"),
    PROFESSIONAL("Professional", "professional"),
    EDUCATOR("Educator", "educator"),
    OTHER("Other", "other")
}

/**
 * Use cases for onboarding
 */
enum class UseCase(val displayName: String, val value: String, val icon: String) {
    LECTURE_NOTES("Lecture Notes", "lecture_notes", "school"),
    STUDY_MATERIALS("Study Materials", "study_materials", "menu_book"),
    MEETING_NOTES("Meeting Notes", "meeting_notes", "groups"),
    RESEARCH("Research", "research", "search"),
    PERSONAL_LEARNING("Personal Learning", "personal_learning", "psychology"),
    OTHER("Other", "other", "more_horiz")
}

/**
 * Onboarding steps
 */
enum class OnboardingStep(val index: Int) {
    USER_TYPE(0),
    USE_CASE(1),
    FEATURE_UPLOAD(2),
    FEATURE_NOTES(3),
    FEATURE_FLASHCARDS(4),
    FEATURE_QUIZ(5),
    FEATURE_AUDIO(6),
    SOCIAL_PROOF(7),
    COMPARISON(8),
    TRIAL(9),
    NOTIFICATIONS(10);

    val totalSteps: Int get() = values().size

    val progress: Float get() = (index + 1).toFloat() / totalSteps.toFloat()

    fun next(): OnboardingStep? {
        return values().find { it.index == this.index + 1 }
    }

    fun previous(): OnboardingStep? {
        return values().find { it.index == this.index - 1 }
    }
}

/**
 * Manages onboarding state and user preferences
 */
class OnboardingManager(context: Context) {

    companion object {
        private const val TAG = "OnboardingManager"
        private const val PREFS_NAME = "onboarding_prefs"
        private const val KEY_HAS_COMPLETED = "has_completed_onboarding"
        private const val KEY_USER_TYPE = "user_type"
        private const val KEY_USE_CASES = "use_cases"
        private const val KEY_PREFERENCES_SYNCED = "preferences_synced"

        @Volatile
        private var instance: OnboardingManager? = null

        fun getInstance(context: Context): OnboardingManager {
            return instance ?: synchronized(this) {
                instance ?: OnboardingManager(context.applicationContext).also { instance = it }
            }
        }
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // State
    private val _currentStep = MutableStateFlow(OnboardingStep.USER_TYPE)
    val currentStep: StateFlow<OnboardingStep> = _currentStep.asStateFlow()

    private val _selectedUserType = MutableStateFlow<UserType?>(null)
    val selectedUserType: StateFlow<UserType?> = _selectedUserType.asStateFlow()

    private val _selectedUseCases = MutableStateFlow<Set<UseCase>>(emptySet())
    val selectedUseCases: StateFlow<Set<UseCase>> = _selectedUseCases.asStateFlow()

    private val _hasCompletedOnboarding = MutableStateFlow(false)
    val hasCompletedOnboarding: StateFlow<Boolean> = _hasCompletedOnboarding.asStateFlow()

    init {
        loadSavedState()
    }

    private fun loadSavedState() {
        _hasCompletedOnboarding.value = prefs.getBoolean(KEY_HAS_COMPLETED, false)

        // Load user type
        prefs.getString(KEY_USER_TYPE, null)?.let { value ->
            _selectedUserType.value = UserType.values().find { it.value == value }
        }

        // Load use cases
        prefs.getStringSet(KEY_USE_CASES, emptySet())?.let { values ->
            _selectedUseCases.value = values.mapNotNull { value ->
                UseCase.values().find { it.value == value }
            }.toSet()
        }
    }

    // MARK: - User Selection

    fun selectUserType(userType: UserType) {
        _selectedUserType.value = userType
    }

    fun toggleUseCase(useCase: UseCase) {
        val current = _selectedUseCases.value.toMutableSet()
        if (current.contains(useCase)) {
            current.remove(useCase)
        } else {
            current.add(useCase)
        }
        _selectedUseCases.value = current
    }

    // MARK: - Navigation

    fun nextStep() {
        val next = _currentStep.value.next()
        if (next != null) {
            _currentStep.value = next
        } else {
            completeOnboarding()
        }
    }

    fun previousStep() {
        _currentStep.value.previous()?.let {
            _currentStep.value = it
        }
    }

    fun goToStep(step: OnboardingStep) {
        _currentStep.value = step
    }

    fun skipOnboarding() {
        completeOnboarding()
    }

    fun skipTrial() {
        // Move to notifications or complete
        if (_currentStep.value == OnboardingStep.TRIAL) {
            nextStep()
        }
    }

    // MARK: - Completion

    private fun completeOnboarding() {
        _hasCompletedOnboarding.value = true

        // Save to preferences
        prefs.edit().apply {
            putBoolean(KEY_HAS_COMPLETED, true)
            _selectedUserType.value?.let { putString(KEY_USER_TYPE, it.value) }
            _selectedUseCases.value.let { useCases ->
                putStringSet(KEY_USE_CASES, useCases.map { it.value }.toSet())
            }
            apply()
        }
    }

    fun markOnboardingComplete() {
        completeOnboarding()
    }

    // MARK: - Backend Sync

    /**
     * Check if preferences need to be synced to backend
     */
    fun needsSync(): Boolean {
        return _hasCompletedOnboarding.value && !prefs.getBoolean(KEY_PREFERENCES_SYNCED, false)
    }

    /**
     * Sync onboarding preferences to backend
     * Call this after user successfully logs in
     */
    fun syncPreferencesToBackend(token: String) {
        if (!needsSync()) {
            Log.d(TAG, "Preferences already synced or onboarding not completed")
            return
        }

        scope.launch {
            try {
                val request = OnboardingPreferencesRequest(
                    userType = _selectedUserType.value?.value,
                    useCases = _selectedUseCases.value.map { it.value }
                )

                val response = RetrofitClient.apiService.saveOnboardingPreferences(
                    "Bearer $token",
                    request
                )

                if (response.isSuccessful && response.body()?.success == true) {
                    prefs.edit().putBoolean(KEY_PREFERENCES_SYNCED, true).apply()
                    Log.d(TAG, "Onboarding preferences synced to backend successfully")

                    // Track analytics
                    AnalyticsService.trackOnboardingCompleted(
                        userType = _selectedUserType.value?.value,
                        useCases = _selectedUseCases.value.map { it.value }
                    )
                } else {
                    Log.e(TAG, "Failed to sync preferences: ${response.errorBody()?.string()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error syncing preferences to backend", e)
            }
        }
    }

    /**
     * Get saved user type value for analytics/backend
     */
    fun getSavedUserType(): String? {
        return prefs.getString(KEY_USER_TYPE, null)
    }

    /**
     * Get saved use cases for analytics/backend
     */
    fun getSavedUseCases(): List<String> {
        return prefs.getStringSet(KEY_USE_CASES, emptySet())?.toList() ?: emptyList()
    }

    // MARK: - Reset (for testing)

    fun reset() {
        _currentStep.value = OnboardingStep.USER_TYPE
        _selectedUserType.value = null
        _selectedUseCases.value = emptySet()
        _hasCompletedOnboarding.value = false

        prefs.edit().clear().apply()
    }
}
