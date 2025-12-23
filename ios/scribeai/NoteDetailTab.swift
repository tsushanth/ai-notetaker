//
//  NoteDetailTab.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import SwiftUI

enum NoteDetailTab: String, CaseIterable {
    case notes = "Notes"
    case summary = "Summary"
    case podcast = "Podcast"
    case quiz = "Quiz"
    case flashcards = "Flashcards"
    case chat = "Chat"
    
    var icon: String {
        switch self {
        case .notes: return "doc.text.fill"
        case .summary: return "square.and.arrow.up.on.square"
        case .podcast: return "waveform"
        case .quiz: return "questionmark.circle.fill"
        case .flashcards: return "rectangle.stack.fill"
        case .chat: return "message.fill"
        }
    }
}

struct NoteDetailTabView: View {
    let note: Note
    @ObservedObject var viewModel: NoteViewModel
    @Environment(\.dismiss) var dismiss
    @State private var selectedTab: NoteDetailTab = .notes
    @State private var previousTab: NoteDetailTab = .notes
    @State private var showingDeleteAlert = false
    @State private var showingShareSheet = false

    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Tab Bar
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(NoteDetailTab.allCases, id: \.self) { tab in
                            TabButton(
                                title: tab.rawValue,
                                icon: tab.icon,
                                isSelected: selectedTab == tab
                            ) {
                                if selectedTab != tab {
                                    // Track tab switch
                                    AnalyticsService.shared.trackTabSwitched(
                                        fromTab: selectedTab.rawValue,
                                        toTab: tab.rawValue,
                                        noteId: note.id
                                    )
                                    previousTab = selectedTab
                                    selectedTab = tab
                                }
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 12)
                }
                .background(Color.cardBackground)
                
                Divider()
                    .background(Color.darkSurfaceVariant)
                
                // Trial Banner (shows when in trial period)
                TrialBannerView()

                // Tab Content
                TabView(selection: $selectedTab) {
                    NotesTabContent(note: note)
                        .tag(NoteDetailTab.notes)

                    SummaryTabContent(note: note)
                        .subscriptionGated(featureName: "AI Summaries")
                        .tag(NoteDetailTab.summary)

                    PodcastTabContent(note: note)
                        .subscriptionGated(featureName: "AI Podcasts")
                        .tag(NoteDetailTab.podcast)

                    QuizTabContent(note: note)
                        .subscriptionGated(featureName: "AI Quizzes")
                        .tag(NoteDetailTab.quiz)

                    FlashcardsTabContent(note: note)
                        .subscriptionGated(featureName: "AI Flashcards")
                        .tag(NoteDetailTab.flashcards)

                    ChatTabContent(note: note)
                        .subscriptionGated(featureName: "AI Chat")
                        .tag(NoteDetailTab.chat)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 2) {
                    Text(note.title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textPrimary)
                        .lineLimit(1)
                    
                    Text(formatDate(note.createdAt))
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)
                }
            }
            
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(action: {
                        showingShareSheet = true
                    }) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    
                    Button(role: .destructive, action: {
                        showingDeleteAlert = true
                    }) {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundColor(.textPrimary)
                }
            }
        }
        .alert("Delete Note", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                deleteNote()
            }
        } message: {
            Text("Are you sure you want to delete this note? This action cannot be undone.")
        }
        .sheet(isPresented: $showingShareSheet) {
            ShareSheet(items: [note.content])
        }
        .onAppear {
            // Track note viewed
            AnalyticsService.shared.trackNoteViewed(noteId: note.id, sourceType: note.sourceType ?? "unknown")
        }
    }
    
    private func deleteNote() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            return
        }

        // Track note deletion
        AnalyticsService.shared.trackNoteDeleted(noteId: note.id)

        Task {
            await viewModel.deleteNote(token: token, noteId: note.id)
            dismiss()
        }
    }
    
    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return "Recently"
        }
        
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .medium
        return dateFormatter.string(from: date)
    }
}

struct TabButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                Text(title)
                    .font(.system(size: 14, weight: .medium))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.purple80 : Color.clear)
            .foregroundColor(isSelected ? .white : .textSecondary)
            .cornerRadius(20)
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .stroke(isSelected ? Color.clear : Color.darkSurfaceVariant, lineWidth: 1)
            )
        }
    }
}
