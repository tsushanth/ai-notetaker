package com.kreativekoala.scribeai.viewmodel

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.TutorialManager

class AuthViewModelFactory(
    private val application: Application,
    private val tutorialManager: TutorialManager,
    private val authManager: AuthManager
) : ViewModelProvider.Factory {

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(AuthViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return AuthViewModel(application, authManager, tutorialManager) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}