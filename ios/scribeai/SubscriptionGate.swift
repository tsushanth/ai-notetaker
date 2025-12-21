//
//  SubscriptionGate.swift
//  scribeai
//
//  Manages trial period and subscription access control
//

import SwiftUI

// MARK: - Subscription Gate Manager

@MainActor
class SubscriptionGateManager: ObservableObject {
    static let shared = SubscriptionGateManager()

    private let defaults = UserDefaults.standard

    // Trial configuration
    static let trialDays = 7

    private enum Keys {
        static let installDate = "analytics_install_date"  // Reuse from AnalyticsService
        static let hasSeenPaywall = "has_seen_paywall_after_trial"
    }

    private init() {}

    // MARK: - Trial Status

    /// Check if user is within the free trial period
    var isInTrialPeriod: Bool {
        let days = daysSinceInstall
        return days < Self.trialDays
    }

    /// Days remaining in trial
    var trialDaysRemaining: Int {
        let remaining = Self.trialDays - daysSinceInstall
        return max(0, remaining)
    }

    /// Days since app was installed
    var daysSinceInstall: Int {
        guard let installDate = defaults.object(forKey: Keys.installDate) as? Date else {
            // First time - set install date
            defaults.set(Date(), forKey: Keys.installDate)
            return 0
        }
        return Calendar.current.dateComponents([.day], from: installDate, to: Date()).day ?? 0
    }

    /// Check if trial has expired
    var hasTrialExpired: Bool {
        return daysSinceInstall >= Self.trialDays
    }

    // MARK: - Access Control

    /// Check if user can access premium features
    /// Returns true if subscribed OR within trial period
    var canAccessPremiumFeatures: Bool {
        // If subscribed, always allow
        if StoreKitManager.shared.isSubscribed {
            return true
        }

        // If within trial period, allow
        if isInTrialPeriod {
            return true
        }

        // Trial expired and not subscribed
        return false
    }

    /// Reason why access is blocked (for UI)
    var accessBlockedReason: String {
        if hasTrialExpired && !StoreKitManager.shared.isSubscribed {
            return "Your 7-day free trial has ended. Subscribe to continue using all features."
        }
        return ""
    }

    // MARK: - For debugging

    func printStatus() {
        #if DEBUG
        print("""
        🔐 SUBSCRIPTION GATE STATUS:
        ============================
        Days since install: \(daysSinceInstall)
        Trial days remaining: \(trialDaysRemaining)
        Is in trial period: \(isInTrialPeriod)
        Has trial expired: \(hasTrialExpired)
        Is subscribed: \(StoreKitManager.shared.isSubscribed)
        Can access premium: \(canAccessPremiumFeatures)
        """)
        #endif
    }

    #if DEBUG
    /// Reset for testing - only available in debug builds
    func resetTrialForTesting() {
        defaults.removeObject(forKey: Keys.installDate)
        defaults.removeObject(forKey: Keys.hasSeenPaywall)
        print("🧪 Trial reset for testing")
    }

    /// Set a specific trial start date for testing
    func setTrialStartDate(_ daysAgo: Int) {
        let date = Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date())
        defaults.set(date, forKey: Keys.installDate)
        print("🧪 Trial start set to \(daysAgo) days ago")
    }
    #endif
}

// MARK: - Subscription Gated View Modifier

struct SubscriptionGatedModifier: ViewModifier {
    @StateObject private var storeManager = StoreKitManager.shared
    @ObservedObject private var gateManager = SubscriptionGateManager.shared
    @State private var showPaywall = false

    let featureName: String

    func body(content: Content) -> some View {
        Group {
            if gateManager.canAccessPremiumFeatures {
                content
            } else {
                // Show paywall blocker
                TrialExpiredView(
                    featureName: featureName,
                    onSubscribe: { showPaywall = true }
                )
            }
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                PaywallView {
                    showPaywall = false
                }
            }
        }
    }
}

// MARK: - Trial Expired View

struct TrialExpiredView: View {
    let featureName: String
    let onSubscribe: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "lock.fill")
                .font(.system(size: 64))
                .foregroundColor(.purple80)

            Text("Trial Ended")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(.textPrimary)

            Text("Your 7-day free trial has ended.\nSubscribe to unlock \(featureName) and all other features.")
                .font(.system(size: 16))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button(action: onSubscribe) {
                HStack {
                    Image(systemName: "crown.fill")
                    Text("Subscribe Now")
                        .fontWeight(.semibold)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Color.purple80)
                .cornerRadius(12)
            }
            .padding(.horizontal, 32)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.darkBackground)
    }
}

// MARK: - Trial Banner View

struct TrialBannerView: View {
    @ObservedObject private var gateManager = SubscriptionGateManager.shared
    @StateObject private var storeManager = StoreKitManager.shared
    @State private var showPaywall = false

    var body: some View {
        // Only show if in trial and not subscribed
        if gateManager.isInTrialPeriod && !storeManager.isSubscribed {
            HStack {
                Image(systemName: "clock.fill")
                    .foregroundColor(.white)

                Text("\(gateManager.trialDaysRemaining) day\(gateManager.trialDaysRemaining == 1 ? "" : "s") left in trial")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white)

                Spacer()

                Button("Upgrade") {
                    showPaywall = true
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.purple80)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.white)
                .cornerRadius(16)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                LinearGradient(
                    colors: [Color.purple80, Color.purple80.opacity(0.8)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .sheet(isPresented: $showPaywall) {
                NavigationView {
                    PaywallView {
                        showPaywall = false
                    }
                }
            }
        }
    }
}

// MARK: - View Extension

extension View {
    /// Gate this view behind subscription/trial check
    func subscriptionGated(featureName: String) -> some View {
        modifier(SubscriptionGatedModifier(featureName: featureName))
    }
}
