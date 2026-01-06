//
//  AnalyticsService.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 12/8/25.
//

import Foundation
import UIKit

class AnalyticsService {
    static let shared = AnalyticsService()
    
    private let defaults = UserDefaults.standard
    
    // Background queue for all analytics work
    private let analyticsQueue = DispatchQueue(label: "com.scribeai.analytics", qos: .utility)
    
    // Batch events to reduce network calls
    private var eventBuffer: [[String: Any]] = []
    private let bufferLimit = 10
    private var flushTimer: Timer?
    
    // MARK: - UserDefaults Keys
    private enum Keys {
        static let userId = "analytics_user_id"
        static let installDate = "analytics_install_date"
        static let firstValueDate = "analytics_first_value_date"
        static let trialStartDate = "analytics_trial_start_date"
        static let trialProductId = "analytics_trial_product_id"
        static let subscriptionStartDate = "analytics_subscription_start_date"
        static let cancelDate = "analytics_cancel_date"
        static let billedSuccessfully = "analytics_billed_successfully"
        static let successActionsCount = "analytics_success_actions"
        static let pendingEvents = "analytics_pending_events"
        static let sessionCount = "analytics_session_count"
        static let totalAppTime = "analytics_total_app_time"
        static let lastSessionDate = "analytics_last_session_date"
    }

    // Session tracking
    private var sessionStartTime: Date?
    private var currentSessionDuration: TimeInterval = 0
    
    // MARK: - Event Types
    enum Event: String {
        // App lifecycle
        case appInstall = "app_install"
        case appLaunch = "app_launch"
        case sessionStart = "session_start"
        case sessionEnd = "session_end"

        // User journey
        case reachedValue = "reached_value"
        case paywallViewed = "paywall_viewed"

        // Subscription events
        case trialStarted = "trial_started"
        case trialCancelled = "trial_cancelled"
        case subscriptionBilled = "subscription_billed"
        case subscriptionRenewed = "subscription_renewed"
        case subscriptionCancelled = "subscription_cancelled"
        case subscriptionExpired = "subscription_expired"

        // Content creation
        case noteCreated = "note_created"
        case noteViewed = "note_viewed"
        case noteDeleted = "note_deleted"
        case contentUploaded = "content_uploaded"
        case youtubeProcessed = "youtube_processed"
        case audioRecorded = "audio_recorded"
        case documentScanned = "document_scanned"

        // AI Feature - Quiz
        case quizTabViewed = "quiz_tab_viewed"
        case quizGenerateStarted = "quiz_generate_started"
        case quizGenerated = "quiz_generated"
        case quizQuestionAnswered = "quiz_question_answered"
        case quizCompleted = "quiz_completed"
        case quizRestarted = "quiz_restarted"

        // AI Feature - Flashcards
        case flashcardsTabViewed = "flashcards_tab_viewed"
        case flashcardsGenerateStarted = "flashcards_generate_started"
        case flashcardsGenerated = "flashcards_generated"
        case flashcardFlipped = "flashcard_flipped"
        case flashcardSwiped = "flashcard_swiped"
        case flashcardsCompleted = "flashcards_completed"

        // AI Feature - Podcast
        case podcastTabViewed = "podcast_tab_viewed"
        case podcastGenerateStarted = "podcast_generate_started"
        case podcastGenerated = "podcast_generated"
        case podcastPlayStarted = "podcast_play_started"
        case podcastPlayPaused = "podcast_play_paused"
        case podcastPlayCompleted = "podcast_play_completed"
        case podcastSkipped = "podcast_skipped"

        // AI Feature - Chat
        case chatTabViewed = "chat_tab_viewed"
        case chatMessageSent = "chat_message_sent"
        case chatUsed = "chat_used"
        case chatSuggestionUsed = "chat_suggestion_used"

        // AI Feature - Summary/Diagram
        case summaryTabViewed = "summary_tab_viewed"
        case summaryGenerated = "summary_generated"
        case diagramGenerated = "diagram_generated"

        // AI Feature - Mind Map
        case mindmapTabViewed = "mindmap_tab_viewed"
        case mindmapGenerateStarted = "mindmap_generate_started"
        case mindmapGenerated = "mindmap_generated"

        // AI Feature - Infographic
        case infographicTabViewed = "infographic_tab_viewed"
        case infographicGenerateStarted = "infographic_generate_started"
        case infographicGenerated = "infographic_generated"
        case infographicSaved = "infographic_saved"

        // Feature discovery
        case featureDiscovered = "feature_discovered"
        case tabSwitched = "tab_switched"

        // Errors
        case processingError = "processing_error"
        case paymentError = "payment_error"
        case featureBlocked = "feature_blocked"

        // Promo codes
        case promoCodeApplied = "promo_code_applied"

        // Onboarding
        case onboardingStarted = "onboarding_started"
        case onboardingStepCompleted = "onboarding_step_completed"
        case onboardingCompleted = "onboarding_completed"
        case onboardingSkipped = "onboarding_skipped"
        case trialSkipped = "trial_skipped"

        // Notifications
        case notificationsEnabled = "notifications_enabled"
        case notificationsDeclined = "notifications_declined"

        // Retention
        case signoutAttempted = "signout_attempted"
        case signoutValueShown = "signout_value_shown"
        case signoutCancelled = "signout_cancelled"
        case signoutCompleted = "signout_completed"
        case deleteAccountAttempted = "delete_account_attempted"
        case deleteAccountValueShown = "delete_account_value_shown"
        case deleteAccountCancelled = "delete_account_cancelled"
        case deleteAccountCompleted = "delete_account_completed"
    }
    
    private init() {
        // Generate user ID if not exists
        if defaults.string(forKey: Keys.userId) == nil {
            defaults.set(UUID().uuidString, forKey: Keys.userId)
        }
        
        // Record install date if first launch
        if defaults.object(forKey: Keys.installDate) == nil {
            defaults.set(Date(), forKey: Keys.installDate)
            track(.appInstall)
        }
        
        // Start flush timer (every 30 seconds)
        startFlushTimer()
        
        // Flush on app background
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }
    
    deinit {
        flushTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }
    
    // MARK: - Core Tracking (Fire and Forget)
    
    /// Track event - completely non-blocking
    func track(_ event: Event, properties: [String: Any]? = nil) {
        // Capture data synchronously (fast)
        let eventData = buildEventData(event: event, properties: properties)
        
        // Everything else happens in background
        analyticsQueue.async { [weak self] in
            self?.bufferEvent(eventData)
        }
        
        // Debug log on main thread is fine (fast)
        #if DEBUG
        print("📊 \(event.rawValue)")
        #endif
    }
    
    private func buildEventData(event: Event, properties: [String: Any]?) -> [String: Any] {
        var eventData: [String: Any] = [
            "event": event.rawValue,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "user_id": defaults.string(forKey: Keys.userId) ?? "unknown",
            "app_version": appVersion,
            "days_since_install": daysSinceInstall,
            "has_reached_value": hasReachedValue,
            "success_actions_count": successActionsCount
        ]
        
        if let props = properties {
            eventData["properties"] = props
        }
        
        return eventData
    }
    
    // MARK: - Event Buffering
    
    private func bufferEvent(_ eventData: [String: Any]) {
        eventBuffer.append(eventData)
        
        // Flush if buffer is full
        if eventBuffer.count >= bufferLimit {
            flushBuffer()
        }
    }
    
    private func flushBuffer() {
        guard !eventBuffer.isEmpty else { return }
        
        let eventsToSend = eventBuffer
        eventBuffer.removeAll()
        
        // Send in background with timeout
        sendEventsBatch(eventsToSend)
    }
    
    private func startFlushTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.flushTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                self?.analyticsQueue.async {
                    self?.flushBuffer()
                }
            }
        }
    }
    
    @objc private func appDidEnterBackground() {
        analyticsQueue.async { [weak self] in
            self?.flushBuffer()
            self?.persistPendingEvents()
        }
    }
    
    // MARK: - Network (Non-blocking with timeout)
    
    private func sendEventsBatch(_ events: [[String: Any]]) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)/api/analytics/batch") else {
            // Queue for later
            persistEvents(events)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 5 // Short timeout - don't wait long
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: ["events": events])
        } catch {
            persistEvents(events)
            return
        }
        
        // Fire and forget - no completion handling needed
        let task = URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            if error != nil || (response as? HTTPURLResponse)?.statusCode != 200 {
                // Silently queue for retry
                self?.analyticsQueue.async {
                    self?.persistEvents(events)
                }
            }
        }
        task.resume()
    }
    
    // MARK: - Persistence (for offline/retry)
    
    private func persistEvents(_ events: [[String: Any]]) {
        var pending = loadPendingEvents()
        pending.append(contentsOf: events)
        
        // Keep only last 200 events
        if pending.count > 200 {
            pending = Array(pending.suffix(200))
        }
        
        savePendingEvents(pending)
    }
    
    private func persistPendingEvents() {
        guard !eventBuffer.isEmpty else { return }
        persistEvents(eventBuffer)
        eventBuffer.removeAll()
    }
    
    private func loadPendingEvents() -> [[String: Any]] {
        guard let data = defaults.data(forKey: Keys.pendingEvents),
              let events = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return events
    }
    
    private func savePendingEvents(_ events: [[String: Any]]) {
        if let data = try? JSONSerialization.data(withJSONObject: events) {
            defaults.set(data, forKey: Keys.pendingEvents)
        }
    }
    
    /// Call when user authenticates to flush pending events
    func flushPendingEvents() {
        analyticsQueue.async { [weak self] in
            guard let self = self else { return }
            
            let pending = self.loadPendingEvents()
            guard !pending.isEmpty else { return }
            
            self.defaults.removeObject(forKey: Keys.pendingEvents)
            self.sendEventsBatch(pending)
        }
    }
    
    // MARK: - Funnel Tracking Methods (All Non-blocking)
    
    func trackReachedValue(contentType: String) {
        analyticsQueue.async { [weak self] in
            guard let self = self else { return }
            
            let isFirst = self.defaults.object(forKey: Keys.firstValueDate) == nil
            
            if isFirst {
                self.defaults.set(Date(), forKey: Keys.firstValueDate)
                self.track(.reachedValue, properties: [
                    "content_type": contentType,
                    "days_to_value": self.daysSinceInstall
                ])
            }
            
            let count = self.defaults.integer(forKey: Keys.successActionsCount) + 1
            self.defaults.set(count, forKey: Keys.successActionsCount)
        }
        
        // Notify review helper (also non-blocking)
        StoreReviewHelper.shared.recordSuccessfulAction()

        // Check if we should prompt for review after this success
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            StoreReviewHelper.shared.checkAndShowPromptIfEligible()
        }
    }
    
    func trackPaywallViewed(source: String) {
        track(.paywallViewed, properties: [
            "source": source,
            "days_since_install": daysSinceInstall,
            "success_actions": successActionsCount
        ])
    }
    
    func trackTrialStarted(productId: String, trialDuration: Int) {
        analyticsQueue.async { [weak self] in
            guard let self = self else { return }
            self.defaults.set(Date(), forKey: Keys.trialStartDate)
            self.defaults.set(productId, forKey: Keys.trialProductId)
        }
        
        track(.trialStarted, properties: [
            "product_id": productId,
            "trial_duration_days": trialDuration,
            "days_since_install": daysSinceInstall,
            "success_actions": successActionsCount
        ])
    }
    
    func trackSubscriptionBilled(productId: String, price: String, currency: String) {
        analyticsQueue.async { [weak self] in
            guard let self = self else { return }
            self.defaults.set(Date(), forKey: Keys.subscriptionStartDate)
            self.defaults.set(true, forKey: Keys.billedSuccessfully)
        }
        
        track(.subscriptionBilled, properties: [
            "product_id": productId,
            "price": price,
            "currency": currency,
            "days_since_trial_start": daysSinceTrialStart,
            "days_since_install": daysSinceInstall
        ])
    }
    
    func trackSubscriptionRenewed(productId: String) {
        track(.subscriptionRenewed, properties: [
            "product_id": productId,
            "months_subscribed": monthsSubscribed
        ])
    }
    
    func trackTrialCancelled(reason: String? = nil) {
        analyticsQueue.async { [weak self] in
            self?.defaults.set(Date(), forKey: Keys.cancelDate)
        }
        
        track(.trialCancelled, properties: [
            "days_in_trial": daysSinceTrialStart,
            "reason": reason ?? "unknown",
            "success_actions": successActionsCount
        ])
    }
    
    func trackSubscriptionCancelled(reason: String? = nil) {
        analyticsQueue.async { [weak self] in
            self?.defaults.set(Date(), forKey: Keys.cancelDate)
        }
        
        track(.subscriptionCancelled, properties: [
            "months_subscribed": monthsSubscribed,
            "reason": reason ?? "unknown"
        ])
    }
    
    // MARK: - Content Events (All Non-blocking)
    
    func trackNoteCreated(sourceType: String) {
        track(.noteCreated, properties: ["source_type": sourceType])
        trackReachedValue(contentType: "note_\(sourceType)")
    }
    
    func trackQuizGenerated(questionCount: Int) {
        track(.quizGenerated, properties: ["question_count": questionCount])
        trackReachedValue(contentType: "quiz")
    }
    
    func trackFlashcardsGenerated(cardCount: Int) {
        track(.flashcardsGenerated, properties: ["card_count": cardCount])
        trackReachedValue(contentType: "flashcards")
    }
    
    func trackPodcastGenerated(durationSeconds: Int) {
        track(.podcastGenerated, properties: ["duration_seconds": durationSeconds])
        trackReachedValue(contentType: "podcast")
    }
    
    func trackChatUsed() {
        track(.chatUsed)
    }

    // MARK: - Quiz Events

    func trackQuizTabViewed(noteId: String) {
        track(.quizTabViewed, properties: ["note_id": noteId])
    }

    func trackQuizGenerateStarted(noteId: String) {
        track(.quizGenerateStarted, properties: ["note_id": noteId])
    }

    func trackQuizQuestionAnswered(questionIndex: Int, isCorrect: Bool, totalQuestions: Int) {
        track(.quizQuestionAnswered, properties: [
            "question_index": questionIndex,
            "is_correct": isCorrect,
            "total_questions": totalQuestions
        ])
    }

    func trackQuizCompleted(score: Int, total: Int, percentageCorrect: Int) {
        track(.quizCompleted, properties: [
            "score": score,
            "total": total,
            "percentage_correct": percentageCorrect
        ])
        trackReachedValue(contentType: "quiz_completed")
    }

    func trackQuizRestarted() {
        track(.quizRestarted)
    }

    // MARK: - Flashcard Events

    func trackFlashcardsTabViewed(noteId: String) {
        track(.flashcardsTabViewed, properties: ["note_id": noteId])
    }

    func trackFlashcardsGenerateStarted(noteId: String) {
        track(.flashcardsGenerateStarted, properties: ["note_id": noteId])
    }

    func trackFlashcardFlipped(cardIndex: Int, totalCards: Int) {
        track(.flashcardFlipped, properties: [
            "card_index": cardIndex,
            "total_cards": totalCards
        ])
    }

    func trackFlashcardSwiped(cardIndex: Int, direction: String) {
        track(.flashcardSwiped, properties: [
            "card_index": cardIndex,
            "direction": direction
        ])
    }

    func trackFlashcardsCompleted(totalCards: Int, totalFlips: Int) {
        track(.flashcardsCompleted, properties: [
            "total_cards": totalCards,
            "total_flips": totalFlips
        ])
        trackReachedValue(contentType: "flashcards_completed")
    }

    // MARK: - Podcast Events

    func trackPodcastTabViewed(noteId: String) {
        track(.podcastTabViewed, properties: ["note_id": noteId])
    }

    func trackPodcastGenerateStarted(noteId: String) {
        track(.podcastGenerateStarted, properties: ["note_id": noteId])
    }

    func trackPodcastPlayStarted(podcastId: String, duration: Int) {
        track(.podcastPlayStarted, properties: [
            "podcast_id": podcastId,
            "duration_seconds": duration
        ])
    }

    func trackPodcastPlayPaused(podcastId: String, currentPosition: Int, duration: Int) {
        let percentPlayed = duration > 0 ? (currentPosition * 100 / duration) : 0
        track(.podcastPlayPaused, properties: [
            "podcast_id": podcastId,
            "current_position_seconds": currentPosition,
            "duration_seconds": duration,
            "percent_played": percentPlayed
        ])
    }

    func trackPodcastPlayCompleted(podcastId: String, duration: Int) {
        track(.podcastPlayCompleted, properties: [
            "podcast_id": podcastId,
            "duration_seconds": duration
        ])
        trackReachedValue(contentType: "podcast_completed")
    }

    func trackPodcastSkipped(direction: String, skipSeconds: Int) {
        track(.podcastSkipped, properties: [
            "direction": direction,
            "skip_seconds": skipSeconds
        ])
    }

    // MARK: - Chat Events

    func trackChatTabViewed(noteId: String) {
        track(.chatTabViewed, properties: ["note_id": noteId])
    }

    func trackChatMessageSent(noteId: String, messageLength: Int) {
        track(.chatMessageSent, properties: [
            "note_id": noteId,
            "message_length": messageLength
        ])
    }

    func trackChatSuggestionUsed(noteId: String, suggestionIndex: Int) {
        track(.chatSuggestionUsed, properties: [
            "note_id": noteId,
            "suggestion_index": suggestionIndex
        ])
    }

    // MARK: - Summary/Diagram Events

    func trackSummaryTabViewed(noteId: String) {
        track(.summaryTabViewed, properties: ["note_id": noteId])
    }

    func trackSummaryGenerated(noteId: String, summaryLength: Int) {
        track(.summaryGenerated, properties: [
            "note_id": noteId,
            "summary_length": summaryLength
        ])
        trackReachedValue(contentType: "summary")
    }

    func trackDiagramGenerated(noteId: String, diagramType: String) {
        track(.diagramGenerated, properties: [
            "note_id": noteId,
            "diagram_type": diagramType
        ])
        trackReachedValue(contentType: "diagram")
    }

    // MARK: - Mind Map Events

    func trackMindMapTabViewed(noteId: String) {
        track(.mindmapTabViewed, properties: ["note_id": noteId])
    }

    func trackMindMapGenerateStarted(noteId: String) {
        track(.mindmapGenerateStarted, properties: ["note_id": noteId])
    }

    func trackMindMapGenerated(noteId: String, nodeCount: Int) {
        track(.mindmapGenerated, properties: [
            "note_id": noteId,
            "node_count": nodeCount
        ])
        trackReachedValue(contentType: "mindmap")
    }

    // MARK: - Note Events

    func trackNoteViewed(noteId: String, sourceType: String) {
        track(.noteViewed, properties: [
            "note_id": noteId,
            "source_type": sourceType
        ])
    }

    func trackNoteDeleted(noteId: String) {
        track(.noteDeleted, properties: ["note_id": noteId])
    }

    // MARK: - Tab & Feature Discovery Events

    func trackTabSwitched(fromTab: String, toTab: String, noteId: String) {
        track(.tabSwitched, properties: [
            "from_tab": fromTab,
            "to_tab": toTab,
            "note_id": noteId
        ])
    }

    func trackFeatureDiscovered(feature: String, source: String) {
        track(.featureDiscovered, properties: [
            "feature": feature,
            "source": source
        ])
    }

    func trackFeatureBlocked(feature: String, reason: String) {
        track(.featureBlocked, properties: [
            "feature": feature,
            "reason": reason
        ])
    }

    // MARK: - Session Events

    /// Called when app becomes active
    func startSession() {
        sessionStartTime = Date()
        let sessionNumber = defaults.integer(forKey: Keys.sessionCount) + 1
        defaults.set(sessionNumber, forKey: Keys.sessionCount)
        defaults.set(Date(), forKey: Keys.lastSessionDate)

        track(.sessionStart, properties: [
            "session_number": sessionNumber,
            "days_since_install": daysSinceInstall
        ])

        #if DEBUG
        print("📊 Session #\(sessionNumber) started")
        #endif
    }

    /// Called when app enters background
    func endSession() {
        guard let startTime = sessionStartTime else { return }

        let sessionDuration = Date().timeIntervalSince(startTime)
        currentSessionDuration = sessionDuration

        // Update total app time
        let totalTime = defaults.double(forKey: Keys.totalAppTime) + sessionDuration
        defaults.set(totalTime, forKey: Keys.totalAppTime)

        track(.sessionEnd, properties: [
            "session_duration_seconds": Int(sessionDuration),
            "total_app_time_minutes": Int(totalTime / 60)
        ])

        sessionStartTime = nil

        #if DEBUG
        print("📊 Session ended. Duration: \(Int(sessionDuration))s, Total: \(Int(totalTime / 60))m")
        #endif
    }

    /// Track app launch (called once per cold start)
    func trackAppLaunch() {
        track(.appLaunch, properties: [
            "session_count": defaults.integer(forKey: Keys.sessionCount),
            "total_app_time_minutes": Int(defaults.double(forKey: Keys.totalAppTime) / 60),
            "days_since_install": daysSinceInstall
        ])
    }

    // Session metrics
    var totalSessionCount: Int {
        defaults.integer(forKey: Keys.sessionCount)
    }

    var totalAppTimeMinutes: Int {
        Int(defaults.double(forKey: Keys.totalAppTime) / 60)
    }

    var daysSinceLastSession: Int {
        guard let lastSession = defaults.object(forKey: Keys.lastSessionDate) as? Date else { return -1 }
        return Calendar.current.dateComponents([.day], from: lastSession, to: Date()).day ?? 0
    }

    // MARK: - Error Events
    
    func trackProcessingError(type: String, message: String) {
        track(.processingError, properties: [
            "error_type": type,
            "error_message": String(message.prefix(200)) // Limit message length
        ])
        StoreReviewHelper.shared.recordCriticalError()
    }
    
    func trackPaymentError(message: String) {
        track(.paymentError, properties: [
            "error_message": String(message.prefix(200))
        ])
    }

    func trackPromoCodeApplied(code: String) {
        track(.promoCodeApplied, properties: [
            "promo_code": code
        ])
    }

    // MARK: - Computed Properties (Cached for speed)
    
    var hasReachedValue: Bool {
        defaults.object(forKey: Keys.firstValueDate) != nil
    }
    
    var isSubscribed: Bool {
        defaults.bool(forKey: Keys.billedSuccessfully)
    }
    
    var successActionsCount: Int {
        defaults.integer(forKey: Keys.successActionsCount)
    }
    
    var daysSinceInstall: Int {
        guard let installDate = defaults.object(forKey: Keys.installDate) as? Date else { return 0 }
        return Calendar.current.dateComponents([.day], from: installDate, to: Date()).day ?? 0
    }
    
    var daysSinceTrialStart: Int {
        guard let trialDate = defaults.object(forKey: Keys.trialStartDate) as? Date else { return -1 }
        return Calendar.current.dateComponents([.day], from: trialDate, to: Date()).day ?? 0
    }
    
    var monthsSubscribed: Int {
        guard let subDate = defaults.object(forKey: Keys.subscriptionStartDate) as? Date else { return 0 }
        return Calendar.current.dateComponents([.month], from: subDate, to: Date()).month ?? 0
    }
    
    // MARK: - Device Info (Cached)
    
    private lazy var appVersion: String = {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
    }()
    
    // MARK: - Debug
    
    func printFunnelMetrics() {
        #if DEBUG
        print("""
        📊 FUNNEL METRICS:
        ==================
        Days since install: \(daysSinceInstall)
        Reached value: \(hasReachedValue)
        Success actions: \(successActionsCount)
        Billed successfully: \(isSubscribed)
        Months subscribed: \(monthsSubscribed)
        Pending events: \(loadPendingEvents().count)

        SESSION METRICS:
        ================
        Total sessions: \(totalSessionCount)
        Total app time: \(totalAppTimeMinutes) minutes
        Days since last session: \(daysSinceLastSession)
        """)
        #endif
    }
    
    func resetForTesting() {
        #if DEBUG
        analyticsQueue.async { [weak self] in
            guard let self = self else { return }
            let keysToRemove = [
                Keys.installDate, Keys.firstValueDate, Keys.trialStartDate,
                Keys.trialProductId, Keys.subscriptionStartDate, Keys.cancelDate,
                Keys.billedSuccessfully, Keys.successActionsCount, Keys.pendingEvents,
                Keys.sessionCount, Keys.totalAppTime, Keys.lastSessionDate
            ]
            keysToRemove.forEach { self.defaults.removeObject(forKey: $0) }
            self.eventBuffer.removeAll()
            self.sessionStartTime = nil
            self.currentSessionDuration = 0
            print("🧪 Analytics reset for testing")
        }
        #endif
    }
}
