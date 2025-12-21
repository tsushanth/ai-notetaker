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
    }
    
    // MARK: - Event Types
    enum Event: String {
        case appInstall = "app_install"
        case appLaunch = "app_launch"
        case reachedValue = "reached_value"
        case paywallViewed = "paywall_viewed"
        case trialStarted = "trial_started"
        case trialCancelled = "trial_cancelled"
        case subscriptionBilled = "subscription_billed"
        case subscriptionRenewed = "subscription_renewed"
        case subscriptionCancelled = "subscription_cancelled"
        case subscriptionExpired = "subscription_expired"
        case noteCreated = "note_created"
        case quizGenerated = "quiz_generated"
        case flashcardsGenerated = "flashcards_generated"
        case podcastGenerated = "podcast_generated"
        case chatUsed = "chat_used"
        case contentUploaded = "content_uploaded"
        case youtubeProcessed = "youtube_processed"
        case audioRecorded = "audio_recorded"
        case documentScanned = "document_scanned"
        case processingError = "processing_error"
        case paymentError = "payment_error"
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
                Keys.billedSuccessfully, Keys.successActionsCount, Keys.pendingEvents
            ]
            keysToRemove.forEach { self.defaults.removeObject(forKey: $0) }
            self.eventBuffer.removeAll()
            print("🧪 Analytics reset for testing")
        }
        #endif
    }
}
