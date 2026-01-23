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
        static let cachedAccessStatus = "cached_access_status"
        static let lastAccessStatusFetch = "last_access_status_fetch"
    }

    // Published properties for server-side status
    @Published private(set) var serverAccessStatus: ServerAccessStatus?
    @Published private(set) var isLoadingStatus = false

    private init() {
        // Load cached status on init
        loadCachedStatus()
    }

    // MARK: - Server-Side Access Status

    /// Fetch access status from server (should be called on app launch and after purchases)
    func refreshAccessStatus() async {
        isLoadingStatus = true
        defer { isLoadingStatus = false }

        // First, check trial status with device ID for abuse prevention
        if let trialResult = await SubscriptionSyncService.shared.checkTrialWithDevice() {
            // Store device trial info for local checks
            deviceTrialExpired = trialResult.deviceTrialUsed == true && trialResult.trialExpired
            print("📱 Device trial check: used=\(trialResult.deviceTrialUsed ?? false), expired=\(trialResult.trialExpired)")
        }

        // Then get full access status
        if let status = await SubscriptionSyncService.shared.getAccessStatus() {
            serverAccessStatus = status
            cacheStatus(status)
            print("✅ Access status refreshed from server")
        }
    }

    /// Track if this device has already used and expired a trial (prevents reinstall abuse)
    @Published private(set) var deviceTrialExpired = false

    /// Cache the access status for offline use
    private func cacheStatus(_ status: ServerAccessStatus) {
        do {
            let data = try JSONEncoder().encode(status)
            defaults.set(data, forKey: Keys.cachedAccessStatus)
            defaults.set(Date(), forKey: Keys.lastAccessStatusFetch)
        } catch {
            print("❌ Failed to cache access status: \(error)")
        }
    }

    /// Load cached status from UserDefaults
    private func loadCachedStatus() {
        guard let data = defaults.data(forKey: Keys.cachedAccessStatus) else { return }
        do {
            serverAccessStatus = try JSONDecoder().decode(ServerAccessStatus.self, from: data)
            print("📦 Loaded cached access status")
        } catch {
            print("❌ Failed to load cached access status: \(error)")
        }
    }

    /// Check if cache is stale (older than 5 minutes)
    var isCacheStale: Bool {
        guard let lastFetch = defaults.object(forKey: Keys.lastAccessStatusFetch) as? Date else {
            return true
        }
        return Date().timeIntervalSince(lastFetch) > 300 // 5 minutes
    }

    // MARK: - Trial Status (Server-Authoritative when available)

    /// Check if user is within the free trial period
    var isInTrialPeriod: Bool {
        // Prefer server status if available
        if let serverStatus = serverAccessStatus {
            return serverStatus.isInTrial
        }
        // Fall back to local calculation
        let days = daysSinceInstall
        return days < Self.trialDays
    }

    /// Days remaining in trial
    var trialDaysRemaining: Int {
        // Prefer server status if available
        if let serverStatus = serverAccessStatus {
            return serverStatus.trialDaysRemaining
        }
        // Fall back to local calculation
        let remaining = Self.trialDays - daysSinceInstall
        return max(0, remaining)
    }

    /// Days since app was installed (local fallback)
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
        // Prefer server status if available
        if let serverStatus = serverAccessStatus {
            return serverStatus.trialExpired
        }
        return daysSinceInstall >= Self.trialDays
    }

    // MARK: - Access Control (Server-Authoritative)

    /// Check if user can access premium features
    /// Returns true if subscribed OR within trial period
    var canAccessPremiumFeatures: Bool {
        // Prefer server status if available
        if let serverStatus = serverAccessStatus {
            return serverStatus.hasAccess
        }

        // SECURITY: If device has already used and expired a trial, deny access
        // This prevents reinstall abuse where users create new accounts on same device
        if deviceTrialExpired && !StoreKitManager.shared.isSubscribed {
            return false
        }

        // Fall back to client-side check
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

    /// Check if user is subscribed (not just in trial)
    var isSubscribed: Bool {
        if let serverStatus = serverAccessStatus {
            return serverStatus.isSubscribed
        }
        return StoreKitManager.shared.isSubscribed
    }

    /// Feature-specific access checks
    var canCreateNotes: Bool {
        if let serverStatus = serverAccessStatus {
            return serverStatus.features.canCreateNotes
        }
        return canAccessPremiumFeatures
    }

    var canUseAI: Bool {
        if let serverStatus = serverAccessStatus {
            return serverStatus.features.canUseAI
        }
        return canAccessPremiumFeatures
    }

    var canGeneratePodcasts: Bool {
        if let serverStatus = serverAccessStatus {
            return serverStatus.features.canGeneratePodcasts
        }
        return canAccessPremiumFeatures
    }

    /// Reason why access is blocked (for UI)
    var accessBlockedReason: String {
        if let serverStatus = serverAccessStatus {
            if serverStatus.trialExpired && !serverStatus.isSubscribed {
                return "Your 7-day free trial has ended. Subscribe to continue using all features."
            }
            if !serverStatus.hasAccess {
                return serverStatus.reason
            }
        }

        // Device-level trial abuse detection
        if deviceTrialExpired && !StoreKitManager.shared.isSubscribed {
            return "Your free trial has already been used on this device. Subscribe to continue using all features."
        }

        if hasTrialExpired && !StoreKitManager.shared.isSubscribed {
            return "Your 7-day free trial has ended. Subscribe to continue using all features."
        }
        return ""
    }

    /// Usage info for free tier
    var usageRemaining: UsageCounts? {
        return serverAccessStatus?.usage.remaining
    }

    var usageLimits: UsageLimits? {
        return serverAccessStatus?.usage.limits
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
        Is subscribed: \(isSubscribed)
        Can access premium: \(canAccessPremiumFeatures)
        Server status available: \(serverAccessStatus != nil)
        Cache stale: \(isCacheStale)
        Device trial expired: \(deviceTrialExpired)
        Device ID: \(SubscriptionSyncService.shared.deviceId)
        """)
        #endif
    }

    #if DEBUG
    /// Reset for testing - only available in debug builds
    func resetTrialForTesting() {
        defaults.removeObject(forKey: Keys.installDate)
        defaults.removeObject(forKey: Keys.hasSeenPaywall)
        defaults.removeObject(forKey: Keys.cachedAccessStatus)
        defaults.removeObject(forKey: Keys.lastAccessStatusFetch)
        serverAccessStatus = nil
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
                    onSubscribe: {
                        // Track paywall view from feature gate
                        AnalyticsService.shared.trackPaywallViewed(source: "feature_gate_\(featureName.lowercased().replacingOccurrences(of: " ", with: "_"))")
                        showPaywall = true
                    }
                )
            }
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                PaywallView(source: "feature_gate_\(featureName.lowercased().replacingOccurrences(of: " ", with: "_"))") {
                    showPaywall = false
                    // Refresh access status after purchase attempt
                    Task {
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                }
            }
        }
        .task {
            // Refresh access status if cache is stale
            if gateManager.isCacheStale {
                await gateManager.refreshAccessStatus()
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
                    // Track paywall view from trial banner
                    AnalyticsService.shared.trackPaywallViewed(source: "trial_banner")
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
                    PaywallView(source: "trial_banner") {
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
