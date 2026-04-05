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
                if isFastlaneSnapshot || onboardingManager.hasCompletedOnboarding {
                    HomeView()
                        .postValueTrialPrompt() // Shows trial prompt after user experiences AI value
                } else {
                    OnboardingView()
                }
            } else {
                LoginView()
            }
        }
    }
}