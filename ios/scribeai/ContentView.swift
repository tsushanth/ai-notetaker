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

    var body: some View {
        Group {
            if authViewModel.isAuthenticated {
                if onboardingManager.hasCompletedOnboarding {
                    HomeView()
                } else {
                    OnboardingView()
                }
            } else {
                LoginView()
            }
        }
    }
}