//
//  NotesTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//
//  Displays note content with formatted markdown support
//

import SwiftUI

struct NotesTabContent: View {
    let note: Note
    @State private var showRawContent = false
    @State private var showSummary = false
    @State private var summary: String?
    @State private var isLoadingSummary = false
    @State private var isGeneratingSummary = false
    @State private var currentNote: Note
    @State private var isCheckingFormatting = false

    init(note: Note) {
        self.note = note
        _currentNote = State(initialValue: note)
    }

    // Cached word count to avoid recalculating
    private var wordCount: Int {
        let contentToCount = currentNote.displayContent
        if contentToCount.count > 100000 {
            return contentToCount.count / 6
        }
        return contentToCount.split(separator: " ").count
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                // Metadata
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundColor(.textSecondary)
                        Text(formatFullDate(currentNote.createdAt))
                            .font(.system(size: 13))
                            .foregroundColor(.textSecondary)
                    }

                    if let sourceType = currentNote.sourceType {
                        sourceRow(sourceType: sourceType, sourceUrl: currentNote.sourceUrl)
                    }

                    HStack {
                        Image(systemName: "doc.text")
                            .foregroundColor(.textSecondary)
                        Text("\(currentNote.content.count.formatted()) characters • \(wordCount.formatted()) words")
                            .font(.system(size: 13))
                            .foregroundColor(.textSecondary)

                        Spacer()

                        // Toggle between formatted and raw
                        if currentNote.hasFormattedContent {
                            Button {
                                showRawContent.toggle()
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: showRawContent ? "text.badge.star" : "doc.plaintext")
                                        .font(.system(size: 12))
                                    Text(showRawContent ? "Formatted" : "Raw")
                                        .font(.system(size: 12))
                                }
                                .foregroundColor(.purple80)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.purple80.opacity(0.15))
                                .cornerRadius(6)
                            }
                        }
                    }

                    // Formatting status indicator
                    if currentNote.isFormatting || isCheckingFormatting {
                        HStack(spacing: 6) {
                            ProgressView()
                                .scaleEffect(0.7)
                            Text("Formatting notes...")
                                .font(.system(size: 12))
                                .foregroundColor(.textTertiary)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top)
                .padding(.bottom, 12)

                // Summary Section (Collapsible)
                summarySection
                    .padding(.horizontal)
                    .padding(.bottom, 12)

                Divider()
                    .background(Color.darkSurfaceVariant)
                    .padding(.horizontal)
                    .padding(.bottom, 16)

                // Content
                if currentNote.hasFormattedContent && !showRawContent {
                    // Formatted markdown view
                    FormattedNoteView(
                        content: currentNote.formattedContent ?? currentNote.content,
                        isFormatted: true
                    )
                    .padding(.horizontal)
                    .textSelection(.enabled)
                } else {
                    // Raw content view (chunked for performance)
                    RawContentView(content: currentNote.content)
                        .padding(.horizontal)
                        .textSelection(.enabled)
                }

                Spacer(minLength: 32)
            }
        }
        .onAppear {
            checkForFormattedContent()
        }
    }

    // MARK: - Check for Formatted Content

    private func checkForFormattedContent() {
        // If note already has formatted content or is very short, skip
        guard !currentNote.hasFormattedContent && currentNote.content.count >= 200 else {
            return
        }

        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            return
        }

        isCheckingFormatting = true

        // Poll for formatted content (formatting happens async on backend)
        Task {
            var attempts = 0
            let maxAttempts = 15 // 15 attempts * 2 seconds = 30 seconds max

            while attempts < maxAttempts {
                attempts += 1

                do {
                    try await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

                    let refreshedNote = try await APIService.shared.fetchNoteById(token: token, noteId: note.id)
                    if refreshedNote.hasFormattedContent {
                        await MainActor.run {
                            self.currentNote = refreshedNote
                            self.isCheckingFormatting = false
                        }
                        return
                    }
                } catch {
                    print("⚠️ Error checking for formatted content: \(error)")
                }
            }

            // Timeout - stop checking
            await MainActor.run {
                self.isCheckingFormatting = false
            }
        }
    }
    
    private func sourceIcon(_ type: String) -> String {
        switch type {
        case "video": return "video.fill"
        case "recording": return "mic.fill"
        case "pdf": return "doc.fill"
        case "scan": return "camera.fill"
        default: return "doc.text.fill"
        }
    }

    private func sourceLabel(_ type: String) -> String {
        switch type.lowercased() {
        case "video": return "YouTube Video"
        case "recording": return "Audio Recording"
        case "pdf": return "PDF Document"
        case "scan": return "Scanned Document"
        case "image": return "Image"
        case "text": return "Text"
        default: return type.capitalized
        }
    }

    @ViewBuilder
    private func sourceRow(sourceType: String, sourceUrl: String?) -> some View {
        if let url = sourceUrl, let linkUrl = URL(string: url) {
            // Clickable source link
            Link(destination: linkUrl) {
                HStack {
                    Image(systemName: sourceIcon(sourceType))
                        .foregroundColor(.purple80)
                    Text("Source: \(sourceLabel(sourceType))")
                        .font(.system(size: 13))
                        .foregroundColor(.purple80)
                    Image(systemName: "arrow.up.forward.square")
                        .font(.system(size: 10))
                        .foregroundColor(.purple80)
                }
            }
        } else {
            // Non-clickable source label
            HStack {
                Image(systemName: sourceIcon(sourceType))
                    .foregroundColor(.textSecondary)
                Text("Source: \(sourceLabel(sourceType))")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
            }
        }
    }

    private func formatFullDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return dateString
        }

        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .long
        dateFormatter.timeStyle = .short
        return dateFormatter.string(from: date)
    }

    // MARK: - Summary Section

    private var summarySection: some View {
        VStack(spacing: 0) {
            // Summary header/toggle button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showSummary.toggle()
                }
                if showSummary && summary == nil && !isLoadingSummary {
                    loadSummary()
                }
            } label: {
                HStack {
                    Image(systemName: "text.alignleft")
                        .font(.system(size: 14))
                        .foregroundColor(.purple80)

                    Text("Summary")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.purple80)

                    if summary != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.accentGreen)
                    }

                    Spacer()

                    Image(systemName: showSummary ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.textSecondary)
                }
                .padding(12)
                .background(Color.cardBackground)
                .cornerRadius(10)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.purple80.opacity(0.3), lineWidth: 1)
                )
            }
            .buttonStyle(PlainButtonStyle())

            // Expanded summary content
            if showSummary {
                VStack(alignment: .leading, spacing: 12) {
                    if isLoadingSummary || isGeneratingSummary {
                        HStack(spacing: 8) {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text(isGeneratingSummary ? "Generating summary..." : "Loading...")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 16)
                    } else if let summaryText = summary {
                        HStack(alignment: .top) {
                            Text(summaryText)
                                .font(.system(size: 14))
                                .foregroundColor(.textPrimary)
                                .lineSpacing(4)

                            Spacer()

                            Button {
                                generateSummary()
                            } label: {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 12))
                                    .foregroundColor(.textSecondary)
                            }
                        }
                    } else {
                        VStack(spacing: 12) {
                            Text("No summary yet")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)

                            Button {
                                generateSummary()
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "sparkles")
                                        .font(.system(size: 12))
                                    Text("Generate Summary")
                                        .font(.system(size: 13, weight: .medium))
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(Color.purple80)
                                .cornerRadius(8)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                }
                .padding(12)
                .background(Color.cardBackground.opacity(0.5))
                .cornerRadius(10)
                .padding(.top, 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Summary Loading/Generation

    private func loadSummary() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            return
        }

        isLoadingSummary = true

        Task {
            do {
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "summary")
                await MainActor.run {
                    self.summary = aiContent?.summary
                    self.isLoadingSummary = false
                }
            } catch {
                await MainActor.run {
                    self.isLoadingSummary = false
                    print("❌ Error loading summary: \(error)")
                }
            }
        }
    }

    private func generateSummary() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            return
        }

        isGeneratingSummary = true

        Task {
            do {
                let aiContent = try await APIService.shared.generateSummary(
                    token: token,
                    noteId: note.id,
                    length: "medium",
                    contentLength: note.content.count
                )
                await MainActor.run {
                    self.summary = aiContent.summary
                    self.isGeneratingSummary = false
                    AnalyticsService.shared.trackSummaryGenerated(
                        noteId: self.note.id,
                        summaryLength: aiContent.summary?.count ?? 0
                    )
                }
            } catch {
                await MainActor.run {
                    self.isGeneratingSummary = false
                    print("❌ Error generating summary: \(error)")
                }
            }
        }
    }
}

// MARK: - Raw Content View (chunked for performance)

struct RawContentView: View {
    let content: String

    private var contentChunks: [String] {
        let chunkSize = 5000
        guard content.count > chunkSize else {
            return [content]
        }

        var chunks: [String] = []
        var currentIndex = content.startIndex

        while currentIndex < content.endIndex {
            let endIndex = content.index(currentIndex, offsetBy: chunkSize, limitedBy: content.endIndex) ?? content.endIndex

            var adjustedEnd = endIndex
            if endIndex < content.endIndex {
                let searchStart = content.index(endIndex, offsetBy: -100, limitedBy: currentIndex) ?? currentIndex
                if let breakPoint = content[searchStart..<endIndex].lastIndex(where: { $0 == " " || $0 == "\n" }) {
                    adjustedEnd = content.index(after: breakPoint)
                }
            }

            chunks.append(String(content[currentIndex..<adjustedEnd]))
            currentIndex = adjustedEnd
        }

        return chunks
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(contentChunks.enumerated()), id: \.offset) { _, chunk in
                Text(chunk)
                    .font(.system(size: 15))
                    .foregroundColor(.textPrimary)
                    .lineSpacing(6)
            }
        }
    }
}