//
//  StoreReviewHelper.swift
//  scribeai
//
//  Smart, user-friendly App Store review prompts
//  Only prompts happy, engaged users
//

import StoreKit
import SwiftUI

class StoreReviewHelper: ObservableObject {
    static let shared = StoreReviewHelper()
    
    // MARK: - UserDefaults Keys
    private let launchCountKey = "app_launch_count"
    private let successActionsKey = "successful_actions_count"
    private let lastErrorDateKey = "last_critical_error_date"
    private let lastSubscriptionEventKey = "last_subscription_event_date"
    private let userDeclinedKey = "user_declined_review"
    private let userRatedKey = "user_has_rated"
    private let lastPromptDateKey = "last_review_prompt_date"
    private let sessionStartKey = "session_start_time"
    
    // MARK: - Published State
    @Published var showSoftPrompt = false
    
    private init() {}
    
    // MARK: - Track Events
    
    /// Call on every app launch
    func recordAppLaunch() {
        let count = UserDefaults.standard.integer(forKey: launchCountKey) + 1
        UserDefaults.standard.set(count, forKey: launchCountKey)
        UserDefaults.standard.set(Date(), forKey: sessionStartKey)
        print("📊 App launch #\(count)")
    }
    
    /// Call when user successfully generates content (note, quiz, flashcard, podcast)
    func recordSuccessfulAction() {
        let count = UserDefaults.standard.integer(forKey: successActionsKey) + 1
        UserDefaults.standard.set(count, forKey: successActionsKey)
        print("✅ Successful action #\(count)")
    }
    
    /// Call when a critical error occurs
    func recordCriticalError() {
        UserDefaults.standard.set(Date(), forKey: lastErrorDateKey)
        print("❌ Critical error recorded")
    }
    
    /// Call when subscription event happens (purchase, renewal, cancel)
    func recordSubscriptionEvent() {
        UserDefaults.standard.set(Date(), forKey: lastSubscriptionEventKey)
        print("💳 Subscription event recorded")
    }
    
    /// Call when user manually rates from settings
    func markAsRated() {
        UserDefaults.standard.set(true, forKey: userRatedKey)
        print("⭐ User marked as rated")
    }
    
    // MARK: - Check Eligibility
    
    /// Check if we should show the soft prompt
    func checkAndShowPromptIfEligible() {
        guard shouldShowPrompt() else {
            print("📊 Review prompt conditions not met")
            return
        }
        
        // Delay to let UI settle
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            self.showSoftPrompt = true
        }
    }
    
    private func shouldShowPrompt() -> Bool {
        let defaults = UserDefaults.standard
        
        // 1. User already rated - never prompt again
        if defaults.bool(forKey: userRatedKey) {
            print("📊 Skip: User already rated")
            return false
        }
        
        // 2. User declined before - respect their choice
        if defaults.bool(forKey: userDeclinedKey) {
            // Check if 60 days passed for retry
            if let lastPrompt = defaults.object(forKey: lastPromptDateKey) as? Date {
                let daysSince = Calendar.current.dateComponents([.day], from: lastPrompt, to: Date()).day ?? 0
                if daysSince < 60 {
                    print("📊 Skip: User declined, only \(daysSince) days ago")
                    return false
                } else {
                    // Reset declined status for retry after 60 days
                    defaults.set(false, forKey: userDeclinedKey)
                    print("📊 Retry eligible: 60+ days since decline")
                }
            }
        }
        
        // 3. Launch count ≥ 5
        let launchCount = defaults.integer(forKey: launchCountKey)
        if launchCount < 5 {
            print("📊 Skip: Only \(launchCount) launches (need 5)")
            return false
        }
        
        // 4. At least 1 successful action
        let successActions = defaults.integer(forKey: successActionsKey)
        if successActions < 1 {
            print("📊 Skip: No successful actions yet")
            return false
        }
        
        // 5. No critical errors in last 24 hours
        if let lastError = defaults.object(forKey: lastErrorDateKey) as? Date {
            let hoursSince = Calendar.current.dateComponents([.hour], from: lastError, to: Date()).hour ?? 0
            if hoursSince < 24 {
                print("📊 Skip: Critical error \(hoursSince)h ago")
                return false
            }
        }
        
        // 6. Not within 24h of subscription event
        if let lastSubEvent = defaults.object(forKey: lastSubscriptionEventKey) as? Date {
            let hoursSince = Calendar.current.dateComponents([.hour], from: lastSubEvent, to: Date()).hour ?? 0
            if hoursSince < 24 {
                print("📊 Skip: Subscription event \(hoursSince)h ago")
                return false
            }
        }
        
        // 7. Session duration > 30 seconds (user isn't frustrated)
        if let sessionStart = defaults.object(forKey: sessionStartKey) as? Date {
            let secondsInSession = Date().timeIntervalSince(sessionStart)
            if secondsInSession < 30 {
                print("📊 Skip: Session too short (\(Int(secondsInSession))s)")
                return false
            }
        }
        
        // 8. At least 45 days since last prompt
        if let lastPrompt = defaults.object(forKey: lastPromptDateKey) as? Date {
            let daysSince = Calendar.current.dateComponents([.day], from: lastPrompt, to: Date()).day ?? 0
            if daysSince < 45 {
                print("📊 Skip: Last prompt was \(daysSince) days ago (need 45)")
                return false
            }
        }
        
        print("📊 ✅ All conditions met for review prompt!")
        return true
    }
    
    // MARK: - Handle User Response
    
    /// User tapped "Yes, I love it!"
    func userRespondedPositive() {
        showSoftPrompt = false
        UserDefaults.standard.set(Date(), forKey: lastPromptDateKey)
        
        // Show Apple's native review prompt
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.requestSystemReview()
        }
        
        // Assume they'll rate (Apple doesn't tell us)
        markAsRated()
    }
    
    /// User tapped "Not yet"
    func userRespondedNegative() {
        showSoftPrompt = false
        UserDefaults.standard.set(true, forKey: userDeclinedKey)
        UserDefaults.standard.set(Date(), forKey: lastPromptDateKey)
        print("📊 User declined review prompt")
    }
    
    /// User dismissed without responding
    func userDismissed() {
        showSoftPrompt = false
        UserDefaults.standard.set(Date(), forKey: lastPromptDateKey)
        print("📊 User dismissed review prompt")
    }
    
    // MARK: - System Review
    
    private func requestSystemReview() {
        if let windowScene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
            SKStoreReviewController.requestReview(in: windowScene)
        }
    }
    
    // MARK: - Debug / Testing
    
    func resetForTesting() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: launchCountKey)
        defaults.removeObject(forKey: successActionsKey)
        defaults.removeObject(forKey: lastErrorDateKey)
        defaults.removeObject(forKey: lastSubscriptionEventKey)
        defaults.removeObject(forKey: userDeclinedKey)
        defaults.removeObject(forKey: userRatedKey)
        defaults.removeObject(forKey: lastPromptDateKey)
        defaults.removeObject(forKey: sessionStartKey)
        print("🧪 StoreReviewHelper reset for testing")
    }
    
    func printDebugInfo() {
        let defaults = UserDefaults.standard
        print("""
        📊 StoreReviewHelper Debug:
        - Launches: \(defaults.integer(forKey: launchCountKey))
        - Success actions: \(defaults.integer(forKey: successActionsKey))
        - User rated: \(defaults.bool(forKey: userRatedKey))
        - User declined: \(defaults.bool(forKey: userDeclinedKey))
        - Last prompt: \(defaults.object(forKey: lastPromptDateKey) as? Date ?? Date.distantPast)
        """)
    }
}
