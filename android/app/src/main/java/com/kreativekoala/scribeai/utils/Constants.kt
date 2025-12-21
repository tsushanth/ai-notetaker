package com.kreativekoala.scribeai.utils

object Constants {
    // Content Types
    const val CONTENT_TYPE_SUMMARY = "summary"
    const val CONTENT_TYPE_QUIZ = "quiz"
    const val CONTENT_TYPE_FLASHCARDS = "flashcards"
    const val CONTENT_TYPE_PODCAST = "podcast"
    const val CONTENT_TYPE_DIAGRAM = "diagram"
    
    // Source Types
    const val SOURCE_TYPE_RECORDING = "recording"
    const val SOURCE_TYPE_PDF = "pdf"
    const val SOURCE_TYPE_VIDEO = "video"
    const val SOURCE_TYPE_SLIDESHOW = "slideshow"
    const val SOURCE_TYPE_MANUAL = "manual"
    
    // Recording Status
    const val STATUS_PROCESSING = "processing"
    const val STATUS_COMPLETED = "completed"
    const val STATUS_FAILED = "failed"
    
    // Summary Lengths
    const val LENGTH_SHORT = "short"
    const val LENGTH_MEDIUM = "medium"
    const val LENGTH_LONG = "long"
    
    // Quiz Difficulties
    const val DIFFICULTY_EASY = "easy"
    const val DIFFICULTY_MEDIUM = "medium"
    const val DIFFICULTY_HARD = "hard"
    
    // Preferences
    const val PREF_AUTH_TOKEN = "auth_token"
    const val PREF_USER_ID = "user_id"
}
