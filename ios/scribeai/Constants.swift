import Foundation

struct Constants {
    static let baseURL = "https://ai-notetaker-backend-917362189743.us-central1.run.app"
    
    // Supabase Configuration
    static let supabaseURL = "https://shufmkocfnjnlwshqrue.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNodWZta29jZm5qbmx3c2hxcnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNzkzMTksImV4cCI6MjA3Nzg1NTMxOX0.WPmgPldx4bt82JCr7K-20-z-53q8926qtDV5rLMSAnw" // Add this
    
    // OAuth Configuration
    static let appleClientID = "kreativekoala.scribeai.auth"
    static let googleClientID = "917362189743-a8n80i547bapojm3u5u734ds9hb9kofa.apps.googleusercontent.com"
    
    struct API {
        static let notes = "/api/notes"
        static let uploadPDF = "/api/uploads/pdf"
        static let uploadAudio = "/api/recordings/upload"
        static let transcribe = "/api/recordings/transcribe"
        static let videoUrl = "/api/uploads/video-url"

        static let podcast = "/api/ai/podcast"
        static let quiz = "/api/ai/quiz"
        static let flashcards = "/api/ai/flashcards"
        static let chat = "/api/ai/chat"

        // Subscription endpoints
        static let subscriptionSync = "/api/subscriptions/sync"
        static let subscriptionStatus = "/api/subscriptions/status"
        static let subscriptionEvent = "/api/subscriptions/event"
        static let subscriptionAccess = "/api/subscriptions/access"
    }
    
    struct Keychain {
        static let accessToken = "accessToken"
        static let refreshToken = "refreshToken"
        static let userId = "userId"
    }
}
