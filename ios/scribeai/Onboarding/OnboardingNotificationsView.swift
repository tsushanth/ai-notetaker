//
//  OnboardingNotificationsView.swift
//  scribeai
//
//  Notification permission request screen
//

import SwiftUI
import UserNotifications

struct NotificationExample: Identifiable {
    let id = UUID()
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String
}

struct OnboardingNotificationsView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @State private var animateCards = false

    let examples: [NotificationExample] = [
        NotificationExample(
            icon: "bell.fill",
            iconColor: .purple80,
            title: "Notes Ready",
            subtitle: "Your Biology lecture notes are ready to review!"
        ),
        NotificationExample(
            icon: "calendar",
            iconColor: .purple80,
            title: "Exam Prep",
            subtitle: "Chemistry exam in 3h - You know 85% of the content. Study the rest?"
        ),
        NotificationExample(
            icon: "bell.fill",
            iconColor: .purple80,
            title: "Quiz Generated",
            subtitle: "New quiz ready for AP Biology Chapter 3"
        )
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Title
            VStack(spacing: 8) {
                Text("Never miss what matters")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)
            }
            .padding(.horizontal, 24)

            Spacer()

            // Subtitle
            Text("Get notified about things like...")
                .font(.system(size: 16))
                .foregroundColor(.textSecondary)
                .padding(.bottom, 24)

            // Notification examples
            VStack(spacing: 12) {
                ForEach(Array(examples.enumerated()), id: \.element.id) { index, example in
                    NotificationExampleCard(example: example)
                        .offset(y: animateCards ? 0 : 20)
                        .opacity(animateCards ? 1 : 0)
                        .animation(
                            .spring(response: 0.5, dampingFraction: 0.8)
                            .delay(Double(index) * 0.15),
                            value: animateCards
                        )
                }
            }
            .padding(.horizontal, 24)

            Spacer()

            // Skip button
            Button {
                manager.completeOnboarding()
            } label: {
                Text("Skip for now")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.textSecondary)
            }
            .padding(.bottom, 16)

            // Enable button
            Button {
                requestNotificationPermission()
            } label: {
                Text("Enable Notifications")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.purple80)
                    .cornerRadius(16)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                animateCards = true
            }
        }
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            DispatchQueue.main.async {
                if granted {
                    AnalyticsService.shared.track(.notificationsEnabled, properties: [:])
                } else {
                    AnalyticsService.shared.track(.notificationsDeclined, properties: [:])
                }
                manager.completeOnboarding()
            }
        }
    }
}

// MARK: - Notification Example Card
struct NotificationExampleCard: View {
    let example: NotificationExample

    var body: some View {
        HStack(spacing: 16) {
            // Icon
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(example.iconColor.opacity(0.2))
                    .frame(width: 44, height: 44)

                Image(systemName: example.icon)
                    .font(.system(size: 18))
                    .foregroundColor(example.iconColor)
            }

            // Content
            VStack(alignment: .leading, spacing: 4) {
                Text(example.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)

                Text(example.subtitle)
                    .font(.system(size: 14))
                    .foregroundColor(.textSecondary)
                    .lineLimit(2)
            }

            Spacer()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.purple80.opacity(0.3), lineWidth: 1)
        )
    }
}

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingNotificationsView()
    }
}
