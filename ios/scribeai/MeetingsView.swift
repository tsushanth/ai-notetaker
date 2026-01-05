//
//  MeetingsView.swift
//  scribeai
//
//  View for listing and managing meeting bot recordings
//

import SwiftUI

struct MeetingsView: View {
    @State private var meetings: [Meeting] = []
    @State private var isLoading = false
    @State private var showCreateSheet = false
    @State private var errorMessage: String?
    @State private var pollingTimer: Timer?

    var body: some View {
        NavigationView {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                if isLoading && meetings.isEmpty {
                    ProgressView("Loading meetings...")
                        .progressViewStyle(CircularProgressViewStyle())
                } else if meetings.isEmpty {
                    emptyStateView
                } else {
                    meetingsList
                }
            }
            .navigationTitle("Meeting Bot")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showCreateSheet = true
                    } label: {
                        Image(systemName: "plus")
                            .foregroundColor(.blue)
                    }
                }
            }
            .sheet(isPresented: $showCreateSheet) {
                JoinMeetingView { meeting in
                    meetings.insert(meeting, at: 0)
                    startPollingIfNeeded()
                }
            }
            .alert("Error", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
            .onAppear {
                loadMeetings()
            }
            .onDisappear {
                stopPolling()
            }
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "video.badge.plus")
                .font(.system(size: 70))
                .foregroundColor(.gray)

            Text("No Meetings Yet")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Enter a meeting link to have our bot join, record, and transcribe automatically.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Button {
                showCreateSheet = true
            } label: {
                HStack {
                    Image(systemName: "video.fill")
                    Text("Join a Meeting")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .cornerRadius(12)
            }
            .padding(.horizontal, 60)
            .padding(.top, 10)
        }
    }

    // MARK: - Meetings List

    private var meetingsList: some View {
        List {
            ForEach(meetings) { meeting in
                MeetingRowView(
                    meeting: meeting,
                    onCancel: { cancelMeeting(meeting) },
                    onDelete: { deleteMeeting(meeting) }
                )
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .refreshable {
            await loadMeetingsAsync()
        }
    }

    // MARK: - Data Loading

    private func loadMeetings() {
        Task {
            await loadMeetingsAsync()
        }
    }

    private func loadMeetingsAsync() async {
        isLoading = true
        do {
            let response = try await APIService.shared.getMeetings()
            await MainActor.run {
                if response.success, let data = response.data {
                    meetings = data
                    startPollingIfNeeded()
                }
                isLoading = false
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }

    private func cancelMeeting(_ meeting: Meeting) {
        Task {
            do {
                try await APIService.shared.cancelMeeting(meetingId: meeting.id)
                await loadMeetingsAsync()
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func deleteMeeting(_ meeting: Meeting) {
        Task {
            do {
                try await APIService.shared.deleteMeeting(meetingId: meeting.id)
                await MainActor.run {
                    meetings.removeAll { $0.id == meeting.id }
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    // MARK: - Polling

    private func startPollingIfNeeded() {
        let hasActiveMeetings = meetings.contains { $0.isActive }
        if hasActiveMeetings && pollingTimer == nil {
            pollingTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
                Task {
                    await loadMeetingsAsync()
                }
            }
        } else if !hasActiveMeetings {
            stopPolling()
        }
    }

    private func stopPolling() {
        pollingTimer?.invalidate()
        pollingTimer = nil
    }
}

// MARK: - Meeting Row View

struct MeetingRowView: View {
    let meeting: Meeting
    let onCancel: () -> Void
    let onDelete: () -> Void

    @State private var showDeleteConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                // Platform Icon
                platformIcon
                    .frame(width: 44, height: 44)
                    .background(platformColor.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                // Content
                VStack(alignment: .leading, spacing: 4) {
                    Text(meeting.title ?? "Untitled Meeting")
                        .font(.headline)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        statusIndicator
                        Text(meeting.status.displayText)
                            .font(.subheadline)
                            .foregroundColor(statusColor)
                    }

                    if let duration = meeting.formattedDuration {
                        Text("Duration: \(duration)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // Actions
                actionButtons
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .confirmationDialog(
            "Delete Meeting",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                onDelete()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to delete this meeting?")
        }
    }

    // MARK: - Components

    private var platformIcon: some View {
        Image(systemName: "video.fill")
            .font(.system(size: 20))
            .foregroundColor(platformColor)
    }

    private var platformColor: Color {
        switch meeting.platform {
        case .zoom: return .blue
        case .googleMeet: return .green
        case .teams: return .purple
        case .webex: return .orange
        case .other: return .gray
        }
    }

    private var statusColor: Color {
        switch meeting.status {
        case .completed: return .green
        case .failed, .cancelled: return .red
        case .recording: return .red
        case .processing, .transcribing: return .orange
        default: return .secondary
        }
    }

    @ViewBuilder
    private var statusIndicator: some View {
        if meeting.status == .recording {
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)
                .modifier(PulseAnimation())
        } else if meeting.isActive {
            ProgressView()
                .scaleEffect(0.6)
        } else {
            Image(systemName: meeting.status.iconName)
                .font(.caption)
                .foregroundColor(statusColor)
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        if meeting.isCancellable {
            Button {
                onCancel()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundColor(.red)
            }
            .buttonStyle(.plain)
        } else if meeting.status == .completed {
            if let noteId = meeting.noteId {
                NavigationLink(destination: NoteLoaderView(noteId: noteId)) {
                    Text("View Note")
                        .font(.subheadline)
                        .foregroundColor(.blue)
                }
            }
        } else if meeting.status == .failed || meeting.status == .cancelled {
            Button {
                showDeleteConfirmation = true
            } label: {
                Image(systemName: "trash")
                    .foregroundColor(.red)
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Note Loader View
// Loads a note by ID and displays NoteDetailView

struct NoteLoaderView: View {
    let noteId: String
    @StateObject private var viewModel = NoteViewModel()
    @State private var note: Note?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading note...")
            } else if let note = note {
                NoteDetailView(note: note, viewModel: viewModel)
            } else if let error = errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundColor(.orange)
                    Text("Failed to load note")
                        .font(.headline)
                    Text(error)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
        }
        .task {
            await loadNote()
        }
    }

    private func loadNote() async {
        isLoading = true
        do {
            guard let token = await TokenManager.shared.getValidToken() else {
                throw APIError.unauthorized
            }
            let loadedNote = try await APIService.shared.fetchNoteById(token: token, noteId: noteId)
            await MainActor.run {
                self.note = loadedNote
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }
}

// MARK: - Pulse Animation Modifier

struct PulseAnimation: ViewModifier {
    @State private var isAnimating = false

    func body(content: Content) -> some View {
        content
            .opacity(isAnimating ? 0.5 : 1.0)
            .onAppear {
                withAnimation(
                    Animation
                        .easeInOut(duration: 0.8)
                        .repeatForever(autoreverses: true)
                ) {
                    isAnimating = true
                }
            }
    }
}

// MARK: - Preview

#Preview {
    MeetingsView()
}
