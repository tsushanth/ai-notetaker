//
//  NotesTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//
//  Displays note content with formatted markdown support
//

import SwiftUI
import AVFoundation

struct NotesTabContent: View {
    let note: Note
    @State private var showRawContent = false
    @State private var showSummary = false
    @State private var summary: String?
    @State private var isLoadingSummary = false
    @State private var isGeneratingSummary = false
    @State private var currentNote: Note
    @State private var isCheckingFormatting = false

    // TTS State
    @State private var showTTS = false
    @State private var isGeneratingTTS = false
    @State private var ttsAudioPlayer: AVAudioPlayer?
    @State private var ttsAudioData: Data?
    @State private var isPlayingTTS = false
    @State private var selectedVoice = "nova"
    @State private var ttsSpeed: Double = 1.0
    @State private var ttsError: String?

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

                // TTS Section (Collapsible)
                ttsSection
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

    // MARK: - TTS Section

    private var ttsSection: some View {
        VStack(spacing: 0) {
            // TTS header/toggle button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showTTS.toggle()
                }
                // Load saved TTS when expanding
                if showTTS {
                    if ttsAudioData == nil && !isGeneratingTTS {
                        loadSavedTTS()
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "speaker.wave.2.fill")
                        .font(.system(size: 14))
                        .foregroundColor(.purple80)

                    Text("Read Aloud")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.purple80)

                    if ttsAudioData != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.accentGreen)
                    }

                    Spacer()

                    Image(systemName: showTTS ? "chevron.up" : "chevron.down")
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

            // Expanded TTS content
            if showTTS {
                VStack(alignment: .leading, spacing: 12) {
                    // Voice selection
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Voice")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.textSecondary)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(APIService.ttsVoices, id: \.id) { voice in
                                    Button {
                                        selectedVoice = voice.id
                                    } label: {
                                        VStack(spacing: 2) {
                                            Text(voice.name)
                                                .font(.system(size: 11, weight: .medium))
                                            Text(voice.gender)
                                                .font(.system(size: 9))
                                                .foregroundColor(selectedVoice == voice.id ? .white.opacity(0.7) : .textTertiary)
                                        }
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(selectedVoice == voice.id ? Color.purple80 : Color.darkSurfaceVariant)
                                        .foregroundColor(selectedVoice == voice.id ? .white : .textPrimary)
                                        .cornerRadius(6)
                                    }
                                }
                            }
                        }
                    }

                    // Speed slider
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Speed")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.textSecondary)
                            Spacer()
                            Text(String(format: "%.1fx", ttsSpeed))
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.purple80)
                        }

                        Slider(value: $ttsSpeed, in: 0.5...2.0, step: 0.25)
                            .accentColor(.purple80)
                    }

                    // Error message
                    if let error = ttsError {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundColor(.red)
                            .padding(8)
                            .background(Color.red.opacity(0.1))
                            .cornerRadius(6)
                    }

                    // Generate / Play controls
                    if isGeneratingTTS {
                        HStack(spacing: 8) {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text("Generating audio...")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 12)
                    } else if ttsAudioData != nil {
                        // Audio player controls
                        HStack(spacing: 16) {
                            Button {
                                stopTTS()
                            } label: {
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 16))
                                    .foregroundColor(.textSecondary)
                                    .frame(width: 44, height: 44)
                                    .background(Color.darkSurfaceVariant)
                                    .cornerRadius(22)
                            }

                            Button {
                                togglePlayTTS()
                            } label: {
                                Image(systemName: isPlayingTTS ? "pause.fill" : "play.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(.white)
                                    .frame(width: 56, height: 56)
                                    .background(Color.purple80)
                                    .cornerRadius(28)
                            }

                            Button {
                                generateTTS()
                            } label: {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 16))
                                    .foregroundColor(.textSecondary)
                                    .frame(width: 44, height: 44)
                                    .background(Color.darkSurfaceVariant)
                                    .cornerRadius(22)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    } else {
                        // Generate button
                        Button {
                            generateTTS()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "speaker.wave.2.fill")
                                    .font(.system(size: 12))
                                Text("Generate Audio")
                                    .font(.system(size: 13, weight: .medium))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.purple80)
                            .cornerRadius(8)
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Text("Convert your notes to speech using AI voices")
                        .font(.system(size: 11))
                        .foregroundColor(.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                .padding(12)
                .background(Color.cardBackground.opacity(0.5))
                .cornerRadius(10)
                .padding(.top, 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - TTS Functions

    private func generateTTS() {
        ttsError = nil
        isGeneratingTTS = true
        stopTTS()

        Task {
            do {
                print("🔊 Generating TTS for note: \(note.id)")

                // Use the new API that saves to storage
                let response = try await APIService.shared.generateTTSForNote(
                    noteId: note.id,
                    voice: selectedVoice,
                    speed: ttsSpeed
                )

                // Download the audio from URL
                guard let audioURL = URL(string: response.audioUrl) else {
                    throw APIError.serverError("Invalid audio URL")
                }

                let (audioData, _) = try await URLSession.shared.data(from: audioURL)

                await MainActor.run {
                    self.ttsAudioData = audioData
                    self.isGeneratingTTS = false

                    // Setup audio player
                    do {
                        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                        try AVAudioSession.sharedInstance().setActive(true)

                        self.ttsAudioPlayer = try AVAudioPlayer(data: audioData)
                        self.ttsAudioPlayer?.delegate = TTSAudioDelegate.shared
                        TTSAudioDelegate.shared.onFinish = {
                            self.isPlayingTTS = false
                        }
                    } catch {
                        print("❌ Error setting up audio player: \(error)")
                        self.ttsError = "Failed to setup audio player"
                    }
                }
            } catch {
                await MainActor.run {
                    self.isGeneratingTTS = false
                    self.ttsError = error.localizedDescription
                    print("❌ Error generating TTS: \(error)")
                }
            }
        }
    }

    private func loadSavedTTS() {
        Task {
            do {
                if let response = try await APIService.shared.getTTSForNote(noteId: note.id) {
                    // Download the audio
                    guard let audioURL = URL(string: response.audioUrl) else { return }
                    let (audioData, _) = try await URLSession.shared.data(from: audioURL)

                    await MainActor.run {
                        self.ttsAudioData = audioData
                        self.selectedVoice = response.voice
                        self.ttsSpeed = response.speed

                        // Setup audio player
                        do {
                            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                            self.ttsAudioPlayer = try AVAudioPlayer(data: audioData)
                            self.ttsAudioPlayer?.delegate = TTSAudioDelegate.shared
                            TTSAudioDelegate.shared.onFinish = {
                                self.isPlayingTTS = false
                            }
                        } catch {
                            print("❌ Error setting up saved audio player: \(error)")
                        }
                    }
                }
            } catch {
                print("❌ Error loading saved TTS: \(error)")
            }
        }
    }

    private func togglePlayTTS() {
        guard let player = ttsAudioPlayer else { return }

        if isPlayingTTS {
            player.pause()
            isPlayingTTS = false
        } else {
            player.play()
            isPlayingTTS = true
        }
    }

    private func stopTTS() {
        ttsAudioPlayer?.stop()
        ttsAudioPlayer?.currentTime = 0
        isPlayingTTS = false
    }
}

// MARK: - TTS Audio Delegate

class TTSAudioDelegate: NSObject, AVAudioPlayerDelegate {
    static let shared = TTSAudioDelegate()
    var onFinish: (() -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            self.onFinish?()
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