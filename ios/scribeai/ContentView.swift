//
//  ContentView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var onboardingManager = OnboardingManager.shared

    private var isFastlaneSnapshot: Bool {
        ProcessInfo.processInfo.arguments.contains("FASTLANE_SNAPSHOT")
    }

    var body: some View {
        Group {
            if isFastlaneSnapshot || authViewModel.isAuthenticated {
                // Anonymous users skip the 11-screen onboarding — they land
                // directly on HomeView's active empty state so the App Store
                // promise ("paste a URL, get a summary") is delivered without
                // any friction wall in between.
                let skipOnboarding = authViewModel.isAnonymous
                if isFastlaneSnapshot || onboardingManager.hasCompletedOnboarding || skipOnboarding {
                    HomeView()
                        .postValueTrialPrompt() // Shows trial prompt after user experiences AI value
                } else {
                    OnboardingView()
                }
            } else {
                // Fallback only — checkAuthStatus auto-mints an anonymous
                // session on cold-start. LoginView appears if anonymous auth
                // is disabled server-side or the network call failed.
                LoginView()
            }
        }
    }
}