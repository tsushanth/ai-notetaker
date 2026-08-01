//
//  NoteDetailTab.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import SwiftUI

enum NoteDetailTab: String, CaseIterable {
    case notes = "Notes"
    case learn = "Learn"
    case create = "Create"
    case compete = "Compete"
    case chat = "Chat"
    case quiz = "Quiz"
    case flashcards = "Flashcards"
    case mindMap = "Mind Map"
    case infographic = "Infographic"
    case podcast = "Podcast"

    var icon: String {
        switch self {
        case .notes: return "doc.text.fill"
        case .learn: return "graduationcap.fill"
        case .create: return "sparkles"
        case .compete: return "trophy.fill"
        case .chat: return "message.fill"
        case .quiz: return "questionmark.circle.fill"
        case .flashcards: return "rectangle.stack.fill"
        case .mindMap: return "brain.head.profile"
        case .infographic: return "chart.bar.doc.horizontal.fill"
        case .podcast: return "waveform"
        }
    }

    // Tabs shown directly in the bottom bar
    static var primaryTabs: [NoteDetailTab] {
        [.notes, .learn, .create, .compete]
    }

    // Tabs hidden behind the More menu
    static var moreTabs: [NoteDetailTab] {
        [.chat, .quiz, .flashcards, .mindMap, .infographic, .podcast]
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
    @State private var showingExportMenu = false

    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Trial Banner (shows when in trial period)
                TrialBannerView()

                // Tab Content
                TabView(selection: $selectedTab) {
                    NotesTabContent(note: note)
                        .tag(NoteDetailTab.notes)

                    LearnTabContent(note: note)
                        .subscriptionGated(featureName: "AI Tutor")
                        .tag(NoteDetailTab.learn)

                    CreateTabContent(note: note)
                        .subscriptionGated(featureName: "AI Create")
                        .tag(NoteDetailTab.create)

                    CompeteTabContent(note: note)
                        .subscriptionGated(featureName: "AI Compete")
                        .tag(NoteDetailTab.compete)

                    ChatTabContent(note: note)
                        .subscriptionGated(featureName: "AI Chat")
                        .tag(NoteDetailTab.chat)

                    QuizTabContent(note: note)
                        .subscriptionGated(featureName: "AI Quizzes")
                        .tag(NoteDetailTab.quiz)

                    FlashcardsTabContent(note: note)
                        .subscriptionGated(featureName: "AI Flashcards")
                        .tag(NoteDetailTab.flashcards)

                    MindMapTabContent(note: note)
                        .subscriptionGated(featureName: "AI Mind Maps")
                        .tag(NoteDetailTab.mindMap)

                    InfographicTabContent(note: note)
                        .subscriptionGated(featureName: "AI Infographics")
                        .tag(NoteDetailTab.infographic)

                    PodcastTabContent(note: note)
                        .subscriptionGated(featureName: "AI Podcasts")
                        .tag(NoteDetailTab.podcast)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .environmentObject(viewModel)

                // Bottom Tab Bar
                bottomTabBar
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
                        showingExportMenu = true
                    }) {
                        Label("Export & Share", systemImage: "square.and.arrow.up")
                    }

                    Button(action: {
                        showingShareSheet = true
                    }) {
                        Label("Quick Share", systemImage: "paperplane")
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
        .sheet(isPresented: $showingExportMenu) {
            ExportMenuView(note: note)
        }
        .sheet(isPresented: $showingShareSheet) {
            ShareSheet(items: [note.content])
        }
        .onAppear {
            // Track note viewed
            AnalyticsService.shared.trackNoteViewed(noteId: note.id, sourceType: note.sourceType ?? "unknown")
        }
    }

    // MARK: - Bottom Tab Bar

    private var isMoreTabSelected: Bool {
        NoteDetailTab.moreTabs.contains(selectedTab)
    }

    private var bottomTabBar: some View {
        HStack(spacing: 0) {
            ForEach(NoteDetailTab.primaryTabs, id: \.self) { tab in
                BottomTabButton(
                    title: tab.rawValue,
                    icon: tab.icon,
                    isSelected: selectedTab == tab
                ) {
                    if selectedTab != tab {
                        AnalyticsService.shared.trackTabSwitched(
                            fromTab: selectedTab.rawValue,
                            toTab: tab.rawValue,
                            noteId: note.id
                        )
                        previousTab = selectedTab
                        selectedTab = tab
                    }
                }
                .frame(maxWidth: .infinity)
            }

            // More menu for the remaining tabs
            Menu {
                ForEach(NoteDetailTab.moreTabs, id: \.self) { tab in
                    Button {
                        if selectedTab != tab {
                            AnalyticsService.shared.trackTabSwitched(
                                fromTab: selectedTab.rawValue,
                                toTab: tab.rawValue,
                                noteId: note.id
                            )
                            previousTab = selectedTab
                            selectedTab = tab
                        }
                    } label: {
                        Label(tab.rawValue, systemImage: tab.icon)
                    }
                }
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: isMoreTabSelected ? "ellipsis.circle.fill" : "ellipsis.circle")
                        .font(.system(size: 22))
                    Text(isMoreTabSelected ? selectedTab.rawValue : "More")
                        .font(.system(size: 11, weight: .medium))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(isMoreTabSelected ? Color.purple80.opacity(0.15) : Color.clear)
                .cornerRadius(10)
                .foregroundColor(isMoreTabSelected ? .purple80 : .textSecondary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Color.cardBackground)
        .overlay(
            Rectangle()
                .fill(Color.darkSurfaceVariant)
                .frame(height: 1),
            alignment: .top
        )
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

// MARK: - Bottom Tab Button (for fixed bottom navigation)
struct BottomTabButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22))

                Text(title)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(isSelected ? Color.purple80.opacity(0.15) : Color.clear)
            .cornerRadius(10)
            .foregroundColor(isSelected ? .purple80 : .textSecondary)
        }
        .buttonStyle(PlainButtonStyle())
    }
}
