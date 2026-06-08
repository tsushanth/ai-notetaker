//
//  HomeView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//

import SwiftUI

struct HomeView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var noteViewModel = NoteViewModel()
    @State private var showingProfile = false
    @State private var refreshTrigger = UUID()
    @State private var showHomePaywall = false

    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Custom Header
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("SCRIBE AI")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundColor(.textPrimary)

                            // Anonymous users have no email yet — show nothing under
                            // the title rather than an empty string. Lossless
                            // anon→real account upgrade is a follow-up ship.
                            if !authViewModel.isAnonymous,
                               let user = authViewModel.currentUser,
                               !user.email.isEmpty {
                                Text(user.email)
                                    .font(.system(size: 13))
                                    .foregroundColor(.textSecondary)
                            }
                        }

                        Spacer()

                        Button(action: {
                            showingProfile = true
                        }) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(.purple80)
                        }
                    }
                    .padding()
                    .background(Color.darkBackground)

                    // Content
                    NoteListView(viewModel: noteViewModel, refreshTrigger: refreshTrigger)
                    
                    // Bottom Navigation
                    BottomNavigationBar(onContentCreated: {
                        print("📱 Content creation sheet dismissed, refreshing notes...")
                        refreshTrigger = UUID()
                    })
                }
            }
            .sheet(isPresented: $showingProfile) {
                ProfileView()
            }
        }
        .navigationViewStyle(.stack)
        .onAppear {
            AnalyticsService.shared.track(.appLaunch)

            // Flush any pending events now that user is authenticated
            AnalyticsService.shared.flushPendingEvents()

            // Suppress the gate paywall right after onboarding — the trial step
            // already gave them the pitch, re-prompting on first home view feels
            // like nagging. App-open paywall still fires on opens 3/5/etc.
            if let completedAt = UserDefaults.standard.object(forKey: OnboardingManager.onboardingCompletedAtKey) as? Date,
               Date().timeIntervalSince(completedAt) < 5 * 60 {
                return
            }

            // Trust local StoreKit first — Transaction.currentEntitlements reflects a
            // fresh purchase before our server has processed the receipt. Only fall back
            // to the server gate (which can lag by seconds after onboarding purchase)
            // if local StoreKit says we're not subscribed.
            Task {
                await StoreKitManager.shared.updateSubscriptionStatus()
                if StoreKitManager.shared.isSubscribed { return }

                await SubscriptionGateManager.shared.refreshAccessStatus()
                let gate = SubscriptionGateManager.shared
                if !gate.canAccessPremiumFeatures && !gate.isInTrialPeriod {
                    await MainActor.run { showHomePaywall = true }
                }
            }
        }
        .sheet(isPresented: $showHomePaywall) {
            ScribeRemotePaywallView(triggerSource: "home_gate") {
                showHomePaywall = false
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .scribeOpenLatestNote)) { _ in
            // User just tapped "View Note" on a generation success screen.
            // Force a notes-list refresh so the new note surfaces at the top of the list.
            refreshTrigger = UUID()
        }
    }
}

struct BottomNavigationBar: View {
    @State private var showingRecording = false
    @State private var showingYouTube = false
    @State private var showingUpload = false
    @State private var showingScanner = false
    @State private var showingMeetings = false
    @State private var showingPhone = false
    @State private var showActionSheet = false
    @State private var showPaywall = false

    var onContentCreated: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Color.darkSurfaceVariant)

            HStack(spacing: 0) {
                Spacer()

                // Add Content Button (centered)
                Button(action: {
                    if !SubscriptionGateManager.shared.canCreateNote() {
                        showPaywall = true
                        return
                    }
                    showActionSheet = true
                }) {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 24))
                        Text("Add Content")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundColor(.purple80)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 24)
                    .background(Color.purple80.opacity(0.15))
                    .cornerRadius(24)
                }

                Spacer()
            }
            .padding(.vertical, 12)
            .background(Color.cardBackground)
        }
        .sheet(isPresented: $showActionSheet) {
            AddContentSheet { option in
                switch option {
                case .recordAudio:
                    SubscriptionGateManager.shared.recordNoteCreation()
                    showingRecording = true
                case .scanDocument:
                    SubscriptionGateManager.shared.recordNoteCreation()
                    showingScanner = true
                case .uploadFile:
                    SubscriptionGateManager.shared.recordNoteCreation()
                    showingUpload = true
                case .youtubeLink:
                    SubscriptionGateManager.shared.recordNoteCreation()
                    showingYouTube = true
                case .joinMeeting:
                    SubscriptionGateManager.shared.recordNoteCreation()
                    showingMeetings = true
                case .phoneCall:
                    showingPhone = true
                }
            }
        }
        .sheet(isPresented: $showingRecording, onDismiss: {
            onContentCreated()
        }) {
            AudioRecordingView()
        }
        .sheet(isPresented: $showingYouTube, onDismiss: {
            onContentCreated()
        }) {
            YouTubeInputView()
        }
        .sheet(isPresented: $showingUpload, onDismiss: {
            onContentCreated()
        }) {
            UploadOptionsView()
        }
        .fullScreenCover(isPresented: $showingScanner, onDismiss: {
            onContentCreated()
        }) {
            ScannerViewWithProcessing(
                onComplete: { noteId in
                    print("📱 Scanner completed with noteId: \(noteId ?? "nil")")
                    showingScanner = false
                },
                onError: { error in
                    print("📱 Scanner error: \(error)")
                    showingScanner = false
                },
                onCancel: {
                    print("📱 Scanner cancelled")
                    showingScanner = false
                }
            )
        }
        .sheet(isPresented: $showingMeetings, onDismiss: {
            onContentCreated()
        }) {
            MeetingsView()
        }
        .sheet(isPresented: $showingPhone, onDismiss: {
            onContentCreated()
        }) {
            PhoneTabView()
        }
        .sheet(isPresented: $showPaywall) {
            ScribeRemotePaywallView(triggerSource: "note_limit_reached") {
                showPaywall = false
            }
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
