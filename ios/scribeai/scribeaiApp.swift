//
//  ScribeAIApp.swift
//  scribeai
//
//  FIXED: Added splash screen on app launch
//

import SwiftUI
import GoogleSignIn
import FacebookCore
import RevenueCat

@main
struct ScribeAIApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var themeManager = ThemeManager.shared
    @StateObject private var paywallCoordinator = PaywallCoordinator.shared
    @State private var showingSplash = true
    @State private var showLaunchPaywall = false
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Initialize Firebase Analytics (free, unlimited)
        FirebaseAnalyticsHelper.shared.initialize()

        // Initialize Facebook SDK for Meta Ads attribution
        FacebookSDKHelper.shared.initialize()

        // Initialize RevenueCat for remote paywall
        #if DEBUG
        Purchases.logLevel = .warn
        #else
        Purchases.logLevel = .warn
        #endif
        Purchases.configure(withAPIKey: "appl_NBCWDmwGCyKQuzJQPjqHUlauPHZ")
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                // Main content
                ContentView()
                    .environmentObject(authViewModel)
                    .onOpenURL { url in
                        print("📱 Received URL: \(url)")

                        // Handle Google Sign-In callback (for native flow)
                        GIDSignIn.sharedInstance.handle(url)

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
                // Track app launch
                AnalyticsService.shared.trackAppLaunch()
                AnalyticsService.shared.startSession()

                // Firebase: Log app open for DAU tracking
                FirebaseAnalyticsHelper.shared.logAppOpen()

                // Facebook: Log app launch
                FacebookSDKHelper.shared.logAppLaunch()

                // Dismiss splash after animation completes
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showingSplash = false
                    }

                    // Show paywall on launch if trial expired and not subscribed
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        FacebookSDKHelper.shared.requestTrackingPermission()

                        let gate = SubscriptionGateManager.shared
                        if !gate.canAccessPremiumFeatures && !gate.isInTrialPeriod {
                            // Only show once per day to avoid annoying users
                            let lastLaunchPaywall = UserDefaults.standard.object(forKey: "lastLaunchPaywallDate") as? Date
                            let shouldShow = lastLaunchPaywall == nil ||
                                Date().timeIntervalSince(lastLaunchPaywall!) > 86400
                            if shouldShow {
                                showLaunchPaywall = true
                                UserDefaults.standard.set(Date(), forKey: "lastLaunchPaywallDate")
                            }
                        }
                    }
                }
            }
            .onChange(of: scenePhase) { newPhase in
                switch newPhase {
                case .active:
                    AnalyticsService.shared.startSession()
                    paywallCoordinator.checkWinbackEligibility()
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
            .sheet(isPresented: $showLaunchPaywall) {
                ScribeRemotePaywallView(triggerSource: "launch_expired") {
                    showLaunchPaywall = false
                }
            }
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
