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
                            
                            if let user = authViewModel.currentUser {
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
            // Record app launch
            StoreReviewHelper.shared.recordAppLaunch()
            AnalyticsService.shared.track(.appLaunch)
                
            // Flush any pending events now that user is authenticated
            AnalyticsService.shared.flushPendingEvents()
            
            // Check if we should show review prompt (delayed)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                StoreReviewHelper.shared.checkAndShowPromptIfEligible()
            }
        }
        .reviewPrompt()
    }
}

struct BottomNavigationBar: View {
    @State private var showingRecording = false
    @State private var showingYouTube = false
    @State private var showingUpload = false
    @State private var showingScanner = false
    @State private var showActionSheet = false
    
    var onContentCreated: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Color.darkSurfaceVariant)
            
            HStack(spacing: 0) {
                Spacer()
                
                // Add Content Button (centered)
                Button(action: {
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
        .confirmationDialog("Add Content", isPresented: $showActionSheet) {
            Button("Record Audio") {
                showingRecording = true
            }
            
            Button("Scan Document") {
                showingScanner = true
            }
            
            Button("Upload PDF/Audio") {
                showingUpload = true
            }
            
            Button("YouTube Link") {
                showingYouTube = true
            }
            
            Button("Cancel", role: .cancel) {}
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
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
