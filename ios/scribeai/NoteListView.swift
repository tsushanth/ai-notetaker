//
//  NoteListView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//  FIXED: Search placeholder text visibility
//  FIXED: Note labels showing dimmed
//  FIXED: Toast message after deleting note
//

import SwiftUI

struct NoteListView: View {
    @ObservedObject var viewModel: NoteViewModel
    @EnvironmentObject var authViewModel: AuthViewModel
    @State private var searchText = ""
    @State private var isRefreshing = false
    @State private var showDeleteConfirmation = false
    @State private var noteToDelete: Note?
    @State private var showDeletedToast = false      // FIX: Toast state
    @State private var deletedNoteTitle = ""         // FIX: Store deleted note title
    
    var refreshTrigger: UUID
    
    var filteredNotes: [Note] {
        if searchText.isEmpty {
            return viewModel.notes
        }
        return viewModel.notes.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.content.localizedCaseInsensitiveContains(searchText)
        }
    }
    
    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                // Search Bar - FIX: Better placeholder visibility
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.gray)
                    
                    ZStack(alignment: .leading) {
                        // FIX: Visible placeholder with proper color
                        if searchText.isEmpty {
                            Text("Search notes...")
                                .foregroundColor(Color(white: 0.5))  // More visible gray
                        }
                        
                        TextField("", text: $searchText)
                            .foregroundColor(.textPrimary)
                    }
                    
                    if !searchText.isEmpty {
                        Button(action: {
                            searchText = ""
                        }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.gray)
                        }
                    }
                }
                .padding()
                .background(Color.cardBackground)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.darkSurfaceVariant, lineWidth: 1)
                )
                .padding(.horizontal)
                .padding(.vertical, 8)
                
                // Notes List
                if viewModel.isLoading && viewModel.notes.isEmpty {
                    Spacer()
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                    Spacer()
                } else if viewModel.notes.isEmpty {
                    EmptyStateView()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            // Notes count header (only when there are many notes)
                            if viewModel.totalNotes > 20 {
                                HStack {
                                    Text("Showing \(viewModel.notes.count) of \(viewModel.totalNotes) notes")
                                        .font(.system(size: 12))
                                        .foregroundColor(.textSecondary)
                                    Spacer()
                                }
                                .padding(.horizontal, 4)
                            }

                            ForEach(filteredNotes) { note in
                                NoteCardWithNavigation(
                                    note: note,
                                    viewModel: viewModel,
                                    onDelete: {
                                        noteToDelete = note
                                        showDeleteConfirmation = true
                                    }
                                )
                            }

                            // Load More section
                            if searchText.isEmpty && viewModel.hasMoreNotes {
                                LoadMoreButton(
                                    isLoading: viewModel.isLoadingMore,
                                    onLoadMore: {
                                        Task {
                                            await loadMoreNotes()
                                        }
                                    }
                                )
                                .padding(.top, 8)
                            }
                        }
                        .padding()
                    }
                    .refreshable {
                        await refreshNotes()
                    }
                }
                
                if let error = viewModel.errorMessage {
                    ErrorBanner(message: error) {
                        viewModel.errorMessage = nil
                    }
                }
            }
            
            // FIX: Toast overlay for delete confirmation
            if showDeletedToast {
                VStack {
                    Spacer()
                    
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        
                        Text("'\(deletedNoteTitle)' deleted")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(Color.black.opacity(0.9))
                    .cornerRadius(12)
                    .shadow(color: .black.opacity(0.3), radius: 10, x: 0, y: 5)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 100)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: showDeletedToast)
                .zIndex(100)
            }
        }
        .confirmationDialog(
            "Delete Note",
            isPresented: $showDeleteConfirmation,
            presenting: noteToDelete
        ) { note in
            Button("Delete", role: .destructive) {
                deleteNote(note)
            }
            Button("Cancel", role: .cancel) {}
        } message: { note in
            Text("Are you sure you want to delete '\(note.title)'? This action cannot be undone.")
        }
        .onAppear {
            loadNotesIfNeeded()
        }
        .onChange(of: refreshTrigger) { _ in
            print("🔄 Refresh trigger changed, reloading notes...")
            loadNotesIfNeeded()
        }
    }
    
    private func loadNotesIfNeeded() {
        Task {
            if let token = await TokenManager.shared.getValidToken() {
                await viewModel.loadNotes(token: token)
            } else {
                print("❌ No valid token available")
                viewModel.errorMessage = "Session expired. Please sign in again."
            }
        }
    }
    
    private func refreshNotes() async {
        if let token = await TokenManager.shared.getValidToken() {
            await viewModel.loadNotes(token: token)
        }
    }

    private func loadMoreNotes() async {
        if let token = await TokenManager.shared.getValidToken() {
            await viewModel.loadMoreNotes(token: token)
        }
    }

    private func deleteNote(_ note: Note) {
        let titleToDelete = note.title  // Store before deletion
        
        Task {
            guard let token = await TokenManager.shared.getValidToken() else {
                viewModel.errorMessage = "Session expired. Please sign in again."
                return
            }
            
            do {
                try await APIService.shared.deleteNote(token: token, noteId: note.id)
                
                await MainActor.run {
                    viewModel.notes.removeAll { $0.id == note.id }
                    print("✅ Note deleted: \(note.title)")
                    
                    // FIX: Show toast
                    deletedNoteTitle = titleToDelete
                    withAnimation {
                        showDeletedToast = true
                    }
                    
                    // Hide toast after 3 seconds
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        withAnimation {
                            showDeletedToast = false
                        }
                    }
                }
            } catch {
                await MainActor.run {
                    viewModel.errorMessage = "Failed to delete note: \(error.localizedDescription)"
                    print("❌ Error deleting note: \(error)")
                }
            }
        }
    }
}

// MARK: - Note Card with Navigation (Menu outside NavigationLink)

struct NoteCardWithNavigation: View {
    let note: Note
    let viewModel: NoteViewModel
    let onDelete: () -> Void
    
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            // NavigationLink covers the card content but NOT the menu
            NavigationLink(destination: NoteDetailTabView(note: note, viewModel: viewModel)) {
                NoteCardContent(note: note)
            }
            .buttonStyle(PlainButtonStyle())
            
            // Menu is overlaid on top and handles its own taps
            Menu {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundColor(.textSecondary)
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44) // Larger tap target
                    .contentShape(Rectangle())
            }
            .padding(.trailing, 12)
            .padding(.bottom, 12)
        }
    }
}

// MARK: - Note Card Content (without menu)
// FIX: Updated with better label colors

struct NoteCardContent: View {
    let note: Note
    
    private var sourceIcon: String {
        switch note.sourceType {
        case "video": return "video.fill"
        case "recording": return "mic.fill"
        case "pdf": return "doc.fill"
        case "scan": return "camera.fill"
        default: return "doc.text.fill"
        }
    }
    
    private var sourceColor: Color {
        switch note.sourceType {
        case "video": return .accentRed
        case "recording": return .purple80
        case "pdf": return .blue
        case "scan": return .green
        default: return .textSecondary
        }
    }
    
    private var sourceLabel: String {
        switch note.sourceType {
        case "video": return "YouTube"
        case "recording": return "Recording"
        case "pdf": return "PDF"
        case "scan": return "Scanned"
        case "upload": return "Upload"  // FIX: Add proper label for uploads
        default: return note.sourceType?.capitalized ?? "Note"
        }
    }

    // Truncate content for preview to avoid performance issues with large notes
    private var contentPreview: String {
        if note.content.count <= 500 {
            return note.content
        }
        return String(note.content.prefix(500)) + "..."
    }

    // Approximate word count for large notes
    private var approximateWordCount: String {
        if note.content.count > 50000 {
            // Approximate for very large content
            let approx = note.content.count / 6
            if approx >= 1000 {
                return "\(approx / 1000)K"
            }
            return approx.formatted()
        }
        return note.content.split(separator: " ").count.formatted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                // Source Icon
                Image(systemName: sourceIcon)
                    .font(.system(size: 14))
                    .foregroundColor(sourceColor)
                
                // Title
                Text(note.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)
                    .lineLimit(1)
                
                Spacer()
                
                // Date
                Text(formatDate(note.createdAt))
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
            }
            
            // Content Preview - only show first 500 chars for performance
            Text(contentPreview)
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)

            // Footer - FIX: Labels with better visibility
            HStack {
                if note.sourceType != nil {
                    Text(sourceLabel)
                        .font(.system(size: 11, weight: .medium))  // FIX: Added weight
                        .foregroundColor(sourceColor)              // FIX: Use sourceColor
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(sourceColor.opacity(0.15))     // FIX: Better contrast
                        .cornerRadius(6)
                }

                Spacer()

                Text("\(approximateWordCount) words")
                    .font(.system(size: 11))
                    .foregroundColor(.textSecondary)  // FIX: Changed from textTertiary

                Spacer()

                // Placeholder space for menu (menu is overlaid separately)
                Color.clear
                    .frame(width: 44, height: 32)
            }
        }
        .padding()
        .background(Color.cardBackground)
        .cornerRadius(12)
    }
    
    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return "Recently"
        }
        
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            let dateFormatter = DateFormatter()
            dateFormatter.dateFormat = "MMM d"
            return dateFormatter.string(from: date)
        }
    }
}

// MARK: - Original NoteCard (kept for backwards compatibility if needed elsewhere)

struct NoteCard: View {
    let note: Note
    let onDelete: () -> Void
    
    private var sourceIcon: String {
        switch note.sourceType {
        case "video": return "video.fill"
        case "recording": return "mic.fill"
        case "pdf": return "doc.fill"
        case "scan": return "camera.fill"
        default: return "doc.text.fill"
        }
    }
    
    private var sourceColor: Color {
        switch note.sourceType {
        case "video": return .accentRed
        case "recording": return .purple80
        case "pdf": return .blue
        case "scan": return .green
        default: return .textSecondary
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                // Source Icon
                Image(systemName: sourceIcon)
                    .font(.system(size: 14))
                    .foregroundColor(sourceColor)
                
                // Title
                Text(note.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)
                    .lineLimit(1)
                
                Spacer()
                
                // Date
                Text(formatDate(note.createdAt))
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
            }
            
            // Content Preview
            Text(note.content)
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            
            // Footer
            HStack {
                if let sourceType = note.sourceType {
                    Text(sourceType.capitalized)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(sourceColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(sourceColor.opacity(0.15))
                        .cornerRadius(6)
                }
                
                Spacer()
                
                Text("\(note.content.count) characters")
                    .font(.system(size: 11))
                    .foregroundColor(.textSecondary)
                
                Spacer()
                
                // Settings Menu
                Menu {
                    Button(role: .destructive, action: onDelete) {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundColor(.textSecondary)
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .padding()
        .background(Color.cardBackground)
        .cornerRadius(12)
    }
    
    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return "Recently"
        }
        
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            let dateFormatter = DateFormatter()
            dateFormatter.dateFormat = "MMM d"
            return dateFormatter.string(from: date)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 64))
                .foregroundColor(.textTertiary)
            
            Text("No notes yet")
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.textPrimary)
            
            Text("Tap the + button to create your first note")
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            
            Spacer()
        }
    }
}

struct ErrorBanner: View {
    let message: String
    let onDismiss: () -> Void
    
    var body: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.accentRed)
            
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(.accentRed)
                .lineLimit(2)
            
            Spacer()
            
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .foregroundColor(.accentRed)
            }
        }
        .padding()
        .background(Color.accentRed.opacity(0.1))
        .cornerRadius(12)
        .padding()
    }
}

// MARK: - Load More Button

struct LoadMoreButton: View {
    let isLoading: Bool
    let onLoadMore: () -> Void

    var body: some View {
        Button(action: onLoadMore) {
            HStack(spacing: 12) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(0.8)
                    Text("Loading...")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.textSecondary)
                } else {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 16))
                        .foregroundColor(.purple80)
                    Text("Load More Notes")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.purple80)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Color.cardBackground)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.purple80.opacity(0.3), lineWidth: 1)
            )
        }
        .disabled(isLoading)
    }
}
