//
//  NotificationService.swift
//  scribeai
//
//  Handles scheduling and managing local notifications
//

import Foundation
import UserNotifications

@MainActor
class NotificationService {
    static let shared = NotificationService()

    private let center = UNUserNotificationCenter.current()

    // Notification identifiers
    private enum NotificationID {
        static let trialReminder = "trial_reminder_day5"
        static let trialEnding = "trial_ending_day7"
    }

    private init() {}

    // MARK: - Permission Check

    func checkPermissionStatus() async -> Bool {
        let settings = await center.notificationSettings()
        return settings.authorizationStatus == .authorized
    }

    // MARK: - Trial Notifications

    /// Schedule trial reminder notifications after user starts a trial
    func scheduleTrialReminders() {
        Task {
            guard await checkPermissionStatus() else {
                print("📵 Notifications not authorized, skipping trial reminders")
                return
            }

            // Day 5 reminder (2 days before trial ends)
            scheduleTrialReminderDay5()

            // Day 7 reminder (trial ending today)
            scheduleTrialEndingDay7()

            print("✅ Trial reminder notifications scheduled")
        }
    }

    private func scheduleTrialReminderDay5() {
        let content = UNMutableNotificationContent()
        content.title = "Your trial ends in 2 days"
        content.body = "Still enjoying ScribeAI? Keep using all premium features or cancel anytime in Settings."
        content.sound = .default
        content.badge = 1

        // Schedule for 5 days from now at 10 AM local time
        var dateComponents = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        if let futureDate = Calendar.current.date(byAdding: .day, value: 5, to: Date()) {
            dateComponents = Calendar.current.dateComponents([.year, .month, .day], from: futureDate)
        }
        dateComponents.hour = 10
        dateComponents.minute = 0

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: false)
        let request = UNNotificationRequest(
            identifier: NotificationID.trialReminder,
            content: content,
            trigger: trigger
        )

        center.add(request) { error in
            if let error = error {
                print("❌ Failed to schedule Day 5 reminder: \(error)")
            } else {
                print("📅 Day 5 trial reminder scheduled")
            }
        }
    }

    private func scheduleTrialEndingDay7() {
        let content = UNMutableNotificationContent()
        content.title = "Your free trial ends today"
        content.body = "Thanks for trying ScribeAI! Your subscription will start today. Cancel anytime in App Store settings if you change your mind."
        content.sound = .default
        content.badge = 1

        // Schedule for 7 days from now at 9 AM local time
        var dateComponents = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        if let futureDate = Calendar.current.date(byAdding: .day, value: 7, to: Date()) {
            dateComponents = Calendar.current.dateComponents([.year, .month, .day], from: futureDate)
        }
        dateComponents.hour = 9
        dateComponents.minute = 0

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: false)
        let request = UNNotificationRequest(
            identifier: NotificationID.trialEnding,
            content: content,
            trigger: trigger
        )

        center.add(request) { error in
            if let error = error {
                print("❌ Failed to schedule Day 7 reminder: \(error)")
            } else {
                print("📅 Day 7 trial ending notification scheduled")
            }
        }
    }

    // MARK: - Cancel Notifications

    /// Cancel trial reminders (call when user subscribes or cancels)
    func cancelTrialReminders() {
        center.removePendingNotificationRequests(withIdentifiers: [
            NotificationID.trialReminder,
            NotificationID.trialEnding
        ])
        print("🗑️ Trial reminder notifications cancelled")
    }

    // MARK: - Notes Ready Notification

    /// Schedule a notification when notes are ready (after background processing)
    func scheduleNotesReadyNotification(noteTitle: String) {
        Task {
            guard await checkPermissionStatus() else { return }

            let content = UNMutableNotificationContent()
            content.title = "Notes Ready"
            content.body = "Your notes for \"\(noteTitle)\" are ready to review!"
            content.sound = .default

            // Trigger immediately (or after a short delay)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            let request = UNNotificationRequest(
                identifier: "notes_ready_\(UUID().uuidString)",
                content: content,
                trigger: trigger
            )

            try? await center.add(request)
        }
    }

    // MARK: - Debug

    func listPendingNotifications() {
        center.getPendingNotificationRequests { requests in
            print("📋 Pending notifications: \(requests.count)")
            for request in requests {
                print("   - \(request.identifier): \(request.content.title)")
            }
        }
    }
}
