//
//  ScribeAIApp.swift
//  scribeai
//
//  FIXED: Added splash screen on app launch
//

import SwiftUI
import GoogleSignIn
import FacebookCore
import PaywallKit
import RatingKit
import PromoOfferKit

@main
struct ScribeAIApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var themeManager = ThemeManager.shared
    @StateObject private var paywallCoordinator = PaywallCoordinator.shared
    @StateObject private var offerCodeManager = OfferCodeManager.shared
    @State private var showingSplash = true
    @State private var showLaunchPaywall = false
    @State private var showAppOpenPaywall = false
    @Environment(\.scenePhase) private var scenePhase

    private static let paywallTriggerOpens: Set<Int> = [1, 3, 5]
    private static let paywallRecurringInterval = 3

    init() {
        // Initialize Firebase Analytics (free, unlimited)
        FirebaseAnalyticsHelper.shared.initialize()

        // Initialize Facebook SDK for Meta Ads attribution
        FacebookSDKHelper.shared.initialize()

        // Initialize TikTok SDK for TikTok Ads attribution
        TikTokHelper.shared.initialize()

        // Apple Search Ads attribution — fetch AdServices token + POST to Apple
        AttributionService.shared.checkAdServicesAttribution()

        // Initialize PaywallKit StoreManager (StoreKit 2)
        StoreManager.shared.configure(productIds: [
            "com.kreativekoala.scribeai.monthly",
            "com.kreativekoala.scribeai.yearly",
            "com.kreativekoala.scribeai.lifetime1"
        ])

        // Initialize PaywallKit SDK (offer-after-dismiss, promo codes)
        PaywallKitSDK.shared.configure(
            appId: "ScribeAI",
            appName: "ScribeAI",
            productIds: [
                "com.kreativekoala.scribeai.monthly",
                "com.kreativekoala.scribeai.yearly",
                "com.kreativekoala.scribeai.lifetime1"
            ]
        )
    
        // Server-driven rating prompts (variant testing + analytics).
        // Currently in simple mode — uses native SKStoreReviewController, no UI overlay.
        RatingKit.configure(appId: "scribeai", apiUrl: "https://paywallkit-api.fly.dev")
        RatingKit.shared.trackAppOpen()

        // Cancel-flow retention: present Apple Promotional Offer to lapsed subscribers
        PromoOfferKit.configure(
            bundleId: "com.kreativekoala.scribeai",
            apiBaseUrl: URL(string: "https://paywallkit-api.fly.dev")!,
            productIdToOfferCode: [
                "com.kreativekoala.scribeai.yearly":  "half_1yr",
                "com.kreativekoala.scribeai.monthly": "half_3mo",
            ],
            isSubscribedProvider: { StoreManager.shared.isPremium },
            onPurchased: { Task { await StoreManager.shared.refreshSubscriptionStatus() } },
            headline: "Come back at half price"
        )
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                // Main content
                ContentView()
                    .ratingPrompt()
                    .promoOffer()
                    .environmentObject(authViewModel)
                    .onOpenURL { url in
                        print("📱 Received URL: \(url)")

                        // Handle Google Sign-In callback (for native flow)
                        GIDSignIn.sharedInstance.handle(url)
                        PromoCodeManager.shared.handleURL(url)

                        // Handle Supabase OAuth callback (for web-based flows)
                        if url.scheme == "kreativekoala.scribeai" {
                            print("✅ Handling Supabase callback")
                            Task {
                                await authViewModel.handleOAuthCallback(url: url)
                            }
                        }
                    }

                // Splash screen overlay
                if showingSplash {
                    SplashScreenView()
                        .transition(.opacity)
                        .zIndex(1)
                }
            }
            .preferredColorScheme(themeManager.colorScheme)
            .onAppear {
                // Don't auto-read the clipboard on cold launch — iOS shows a
                // "ScribeAI Learn would like to paste from <other device>"
                // prompt every time, which scares users. The paywall already
                // has a manual promo-code entry field; if a deep-link / URL
                // promo arrives we handle it in `handleURL` instead.
                Task { await OfferCodeManager.shared.refresh(appId: "scribeai") }
                // Track app launch
                AnalyticsService.shared.trackAppLaunch()
                AnalyticsService.shared.startSession()

                // Firebase: Log app open for DAU tracking
                FirebaseAnalyticsHelper.shared.logAppOpen()

                // Facebook: Log app launch
                FacebookSDKHelper.shared.logAppLaunch()

                // Dismiss splash after animation completes
                let snapshotDelay: Double = ProcessInfo.processInfo.arguments.contains("FASTLANE_SNAPSHOT") ? 0.0 : 2.5
                DispatchQueue.main.asyncAfter(deadline: .now() + snapshotDelay) {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showingSplash = false
                    }

                    // Show paywall on launch if trial expired and not subscribed
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        FacebookSDKHelper.shared.requestTrackingPermission()
                        TikTokHelper.shared.requestTrackingPermission()

                        // Refresh both StoreKit and server access status
                        Task {
                            await StoreManager.shared.refreshSubscriptionStatus()
                            await SubscriptionGateManager.shared.refreshAccessStatus()

                            await MainActor.run {
                                if !ProcessInfo.processInfo.arguments.contains("FASTLANE_SNAPSHOT") {
                                    // Skip launch + app-open paywalls during onboarding;
                                    // the trial step covers that surface and re-showing
                                    // overtop of the onboarding flow looks broken.
                                    guard OnboardingManager.shared.hasCompletedOnboarding else { return }

                                    let gate = SubscriptionGateManager.shared
                                    if !gate.canAccessPremiumFeatures && !gate.isInTrialPeriod {
                                        showLaunchPaywall = true
                                    }
                                    checkAppOpenPaywall()
                                }
                            }
                        }
                    }
                }
            }
            .onChange(of: scenePhase) { newPhase in
                switch newPhase {
                case .active:
                    AnalyticsService.shared.startSession()
                    if !ProcessInfo.processInfo.arguments.contains("FASTLANE_SNAPSHOT") {
                        paywallCoordinator.checkWinbackEligibility()
                    }
                case .background:
                    AnalyticsService.shared.endSession()
                case .inactive:
                    break
                @unknown default:
                    break
                }
            }
            .sheet(isPresented: $paywallCoordinator.showWinbackOffer) {
                WinbackOfferView()
            }
            .sheet(isPresented: $showLaunchPaywall, onDismiss: maybeShowOfferCode) {
                ScribeRemotePaywallView(triggerSource: "launch_expired") {
                    showLaunchPaywall = false
                }
            }
            .fullScreenCover(isPresented: $showAppOpenPaywall, onDismiss: maybeShowOfferCode) {
                ScribeRemotePaywallView(triggerSource: "app_open") {
                    showAppOpenPaywall = false
                }
            }
            // OfferCodeView removed: not exported by current PaywallKit version. Apple's
            // native redemption sheet (via SKPaymentQueue.default().presentCodeRedemptionSheet())
            // is used instead at the call sites that previously opened this sheet.
            // (Left the OfferCodeManager flag wiring intact so re-enabling is a one-line restore
            // if PaywallKit ships a public OfferCodeView again.)
        }
    }

    /// Shows the offer-code sheet if the user dismissed a paywall without purchasing
    /// and the server config is enabled.
    private func maybeShowOfferCode() {
        guard !StoreManager.shared.isPremium else { return }
        guard !SubscriptionGateManager.shared.canAccessPremiumFeatures else { return }
        guard offerCodeManager.shouldShow() else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            offerCodeManager.isShowingOfferSheet = true
        }
    }

    private func checkAppOpenPaywall() {
        guard !SubscriptionGateManager.shared.canAccessPremiumFeatures else { return }
        let key = "com.scribeai.appOpenCount"
        let count = UserDefaults.standard.integer(forKey: key) + 1
        UserDefaults.standard.set(count, forKey: key)
        let shouldShow = Self.paywallTriggerOpens.contains(count)
            || (count > 5 && (count - 5) % Self.paywallRecurringInterval == 0)
        if shouldShow {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { showAppOpenPaywall = true }
        }
    }
}

// MARK: - Splash Screen View

struct SplashScreenView: View {
    @State private var logoScale: CGFloat = 0.5
    @State private var logoOpacity: Double = 0
    @State private var textOpacity: Double = 0
    @State private var isAnimating = false
    
    var body: some View {
        ZStack {
            // Background
            Color.darkBackground
                .ignoresSafeArea()
            
            VStack(spacing: 24) {
                // App Icon/Logo
                ZStack {
                    // Glow effect
                    Circle()
                        .fill(Color.purple80.opacity(0.3))
                        .frame(width: 140, height: 140)
                        .blur(radius: 30)
                        .scaleEffect(isAnimating ? 1.2 : 0.8)
                        .animation(
                            .easeInOut(duration: 1.5)
                            .repeatForever(autoreverses: true),
                            value: isAnimating
                        )
                    
                    // Icon background
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [Color.purple80, Color.purple80.opacity(0.7)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 100, height: 100)
                        .shadow(color: Color.purple80.opacity(0.5), radius: 20, x: 0, y: 10)
                    
                    // Icon
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.white)
                }
                .scaleEffect(logoScale)
                .opacity(logoOpacity)
                
                // App Name
                VStack(spacing: 8) {
                    Text("SCRIBE AI")
                        .font(.system(size: 32, weight: .bold))
                        .foregroundColor(.textPrimary)
                        .tracking(2)
                    
                    Text("Your AI-Powered Study Assistant")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.textSecondary)
                }
                .opacity(textOpacity)
            }
        }
        .onAppear {
            // Animate logo
            withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) {
                logoScale = 1.0
                logoOpacity = 1.0
            }
            
            // Animate text after logo
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                withAnimation(.easeOut(duration: 0.5)) {
                    textOpacity = 1.0
                }
            }
            
            // Start pulse animation
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                isAnimating = true
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Preview

#Preview {
    SplashScreenView()
}
