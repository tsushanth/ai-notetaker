import SwiftUI
import AVFoundation

struct PodcastTabContent: View {
    let note: Note
    @State private var podcast: Podcast?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var isPlaying = false
    @State private var isBuffering = false
    @State private var audioPlayer: AVAudioPlayer?
    @State private var errorMessage: String?
    @State private var showRegenerateConfirmation = false
    
    // Audio progress tracking
    @State private var currentTime: TimeInterval = 0
    @State private var duration: TimeInterval = 0
    @State private var progressTimer: Timer?
    @State private var isDragging = false
    
    // Audio delegate for playback completion
    @StateObject private var audioDelegate = AudioPlayerDelegate()
    
    var body: some View {
        VStack(spacing: 20) {
            if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                    .scaleEffect(1.5)
            } else if isGenerating {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(1.5)
                    
                    Text("Generating podcast...")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                    
                    Text("This may take a few moments")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
                .frame(maxHeight: .infinity)
            } else if let podcast = podcast {
                // Podcast Player
                VStack(spacing: 24) {
                    Spacer()
                    
                    // Podcast Icon - Tappable
                    Button(action: {
                        togglePlayback()
                    }) {
                        ZStack {
                            if isPlaying {
                                Circle()
                                    .fill(Color.purple80.opacity(0.3))
                                    .frame(width: 140, height: 140)
                                    .scaleEffect(isPlaying ? 1.2 : 1.0)
                                    .opacity(isPlaying ? 0.0 : 1.0)
                                    .animation(
                                        .easeInOut(duration: 1.5)
                                            .repeatForever(autoreverses: false),
                                        value: isPlaying
                                    )
                            }
                            
                            Circle()
                                .fill(Color.purple80.opacity(0.2))
                                .frame(width: 120, height: 120)
                            
                            if isBuffering {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                                    .scaleEffect(1.5)
                            } else {
                                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                    .font(.system(size: 80))
                                    .foregroundColor(.purple80)
                            }
                        }
                    }
                    .buttonStyle(PlainButtonStyle())
                    .disabled(isBuffering)
                    
                    // Title and Status
                    VStack(spacing: 8) {
                        Text(note.title)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.textPrimary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        
                        HStack(spacing: 4) {
                            Circle()
                                .fill(statusColor(podcast.status))
                                .frame(width: 8, height: 8)
                            Text(podcast.status.capitalized)
                                .font(.system(size: 12))
                                .foregroundColor(.textSecondary)
                        }
                    }
                    
                    // Audio Controls
                    if audioPlayer != nil {
                        VStack(spacing: 8) {
                            // Progress Slider
                            Slider(
                                value: Binding(
                                    get: { currentTime },
                                    set: { newValue in
                                        currentTime = newValue
                                        isDragging = true
                                    }
                                ),
                                in: 0...max(duration, 1),
                                onEditingChanged: { editing in
                                    if !editing {
                                        audioPlayer?.currentTime = currentTime
                                        isDragging = false
                                    }
                                }
                            )
                            .accentColor(.purple80)
                            .padding(.horizontal, 32)
                            
                            // Time Labels
                            HStack {
                                Text(formatTime(currentTime))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(.textSecondary)
                                    .monospacedDigit()
                                
                                Spacer()
                                
                                Text(formatTime(duration))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(.textSecondary)
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, 32)
                        }
                        
                        // Playback Controls
                        HStack(spacing: 40) {
                            // Rewind 15 seconds
                            Button(action: {
                                skip(by: -15)
                            }) {
                                Image(systemName: "gobackward.15")
                                    .font(.system(size: 28))
                                    .foregroundColor(.textPrimary)
                            }
                            
                            // Play/Pause
                            Button(action: {
                                togglePlayback()
                            }) {
                                ZStack {
                                    Circle()
                                        .fill(Color.purple80)
                                        .frame(width: 64, height: 64)
                                    
                                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                                        .font(.system(size: 24))
                                        .foregroundColor(.white)
                                        .offset(x: isPlaying ? 0 : 2)
                                }
                            }
                            .disabled(isBuffering)
                            
                            // Forward 15 seconds
                            Button(action: {
                                skip(by: 15)
                            }) {
                                Image(systemName: "goforward.15")
                                    .font(.system(size: 28))
                                    .foregroundColor(.textPrimary)
                            }
                        }
                        .padding(.top, 8)
                    } else {
                        // Initial Play Button (before audio is loaded)
                        Button(action: {
                            togglePlayback()
                        }) {
                            HStack {
                                if isBuffering {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "play.fill")
                                }
                                Text(isBuffering ? "Loading..." : "Play Podcast")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(isBuffering ? Color.purple80.opacity(0.6) : Color.purple80)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(isBuffering)
                        .padding(.horizontal, 32)
                    }
                    
                    // Regenerate Button
                    Button(action: {
                        showRegenerateConfirmation = true
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.clockwise")
                            Text("Regenerate Podcast")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .foregroundColor(.textSecondary)
                        .padding(.vertical, 12)
                        .padding(.horizontal, 20)
                        .background(Color.cardBackground)
                        .cornerRadius(20)
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .stroke(Color.darkSurfaceVariant, lineWidth: 1)
                        )
                    }
                    .disabled(isBuffering || isPlaying)
                    .opacity(isBuffering || isPlaying ? 0.5 : 1.0)
                    
                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.accentRed)
                            .padding()
                            .background(Color.accentRed.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal, 32)
                    }
                    
                    Spacer()
                }
            } else {
                // Generate Podcast UI
                VStack(spacing: 24) {
                    Spacer()
                    
                    Image(systemName: "waveform.circle.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.purple80)
                    
                    Text("Generate AI Podcast")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.textPrimary)
                    
                    Text("Transform your notes into an engaging podcast conversation")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                    
                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.accentRed)
                            .padding()
                            .background(Color.accentRed.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal, 32)
                    }
                    
                    Button(action: {
                        if let _ = KeychainService.shared.get(Constants.Keychain.accessToken) {
                            generatePodcast()
                        }
                    }) {
                        HStack(spacing: 8) {
                            if isGenerating {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "sparkles")
                            }
                            Text(isGenerating ? "Generating..." : "Generate")
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(isGenerating ? Color.purple80.opacity(0.6) : Color.purple80)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(isGenerating)
                    .padding(.horizontal, 32)
                    
                    Spacer()
                }
            }
        }
        .onAppear {
            loadPodcast()
            setupAudioSession()
        }
        .onDisappear {
            stopProgressTimer()
            audioPlayer?.stop()
            audioPlayer = nil
        }
        .alert("Regenerate Podcast?", isPresented: $showRegenerateConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Regenerate", role: .destructive) {
                regeneratePodcast()
            }
        } message: {
            Text("This will create a new podcast and replace the current one. This action cannot be undone.")
        }
    }
    
    // MARK: - Audio Session Setup
    
    private func setupAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            print("❌ Failed to setup audio session: \(error)")
        }
    }
    
    // MARK: - Playback Controls
    
    private func togglePlayback() {
        guard !isBuffering else {
            print("⚠️ Already buffering, ignoring tap")
            return
        }
        
        guard let podcast = podcast else { return }
        
        if let player = audioPlayer {
            if isPlaying {
                player.pause()
                isPlaying = false
                stopProgressTimer()
            } else {
                player.play()
                isPlaying = true
                startProgressTimer()
            }
        } else {
            loadAndPlayAudio(from: podcast.audioUrl)
        }
    }
    
    private func loadAndPlayAudio(from urlString: String) {
        guard !isBuffering else {
            print("⚠️ Already loading audio, ignoring request")
            return
        }
        
        guard audioPlayer == nil else {
            print("⚠️ Audio player already exists, resuming playback")
            audioPlayer?.play()
            isPlaying = true
            startProgressTimer()
            return
        }
        
        guard let url = URL(string: urlString) else {
            errorMessage = "Invalid audio URL"
            return
        }
        
        isBuffering = true
        errorMessage = nil
        
        audioDelegate.onPlaybackFinished = { [self] in
            DispatchQueue.main.async {
                self.isPlaying = false
                self.currentTime = 0
                self.audioPlayer?.currentTime = 0
                self.stopProgressTimer()
            }
        }
        
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                
                await MainActor.run {
                    guard self.audioPlayer == nil else {
                        print("⚠️ Player was created while downloading, skipping")
                        self.isBuffering = false
                        return
                    }
                    
                    do {
                        let player = try AVAudioPlayer(data: data)
                        player.delegate = audioDelegate
                        player.prepareToPlay()
                        
                        self.audioPlayer = player
                        self.duration = player.duration
                        self.currentTime = 0
                        
                        player.play()
                        self.isPlaying = true
                        self.isBuffering = false
                        
                        startProgressTimer()
                        
                        print("✅ Audio loaded. Duration: \(formatTime(player.duration))")
                    } catch {
                        self.errorMessage = "Failed to play audio: \(error.localizedDescription)"
                        self.isBuffering = false
                    }
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = "Failed to download audio: \(error.localizedDescription)"
                    self.isBuffering = false
                }
            }
        }
    }
    
    private func skip(by seconds: Double) {
        guard let player = audioPlayer else { return }
        
        let newTime = max(0, min(player.currentTime + seconds, player.duration))
        player.currentTime = newTime
        currentTime = newTime
    }
    
    // MARK: - Progress Timer
    
    private func startProgressTimer() {
        stopProgressTimer()
        
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            guard let player = audioPlayer, !isDragging else { return }
            
            currentTime = player.currentTime
            
            if !player.isPlaying && currentTime >= duration - 0.5 {
                isPlaying = false
                currentTime = 0
                player.currentTime = 0
                stopProgressTimer()
            }
        }
    }
    
    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }
    
    // MARK: - Time Formatting
    
    private func formatTime(_ time: TimeInterval) -> String {
        let totalSeconds = Int(time)
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
    
    // MARK: - Load Podcast
    
    private func loadPodcast() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("❌ No auth token found")
            isLoading = false
            return
        }
        
        print("🎙️ Loading podcast for note: \(note.id)")
        
        Task {
            do {
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "podcast")
                await MainActor.run {
                    if let audioUrl = aiContent?.audioUrl {
                        print("✅ Podcast loaded with audio: \(audioUrl)")
                        self.podcast = Podcast(
                            id: aiContent?.id ?? UUID().uuidString,
                            noteId: note.id,
                            audioUrl: audioUrl,
                            duration: aiContent?.duration,
                            status: aiContent?.status ?? "completed",
                            createdAt: aiContent?.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                    } else {
                        print("ℹ️ No podcast found")
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    print("❌ Error loading podcast: \(error)")
                }
            }
        }
    }
    
    // MARK: - Generate Podcast
    
    private func generatePodcast() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }
        
        isGenerating = true
        errorMessage = nil
        
        print("🎙️ Starting podcast generation for note: \(note.id)")
        
        Task {
            do {
                print("📤 Calling generatePodcast API...")
                let aiContent = try await APIService.shared.generatePodcast(token: token, noteId: note.id, contentLength: note.content.count)
                
                print("✅ API returned: \(aiContent)")
                
                if let audioUrl = aiContent.audioUrl {
                    let durationSeconds = Int(self.duration)
                        AnalyticsService.shared.trackPodcastGenerated(durationSeconds: durationSeconds)
                    await MainActor.run {
                        self.podcast = Podcast(
                            id: aiContent.id ?? UUID().uuidString,
                            noteId: note.id,
                            audioUrl: audioUrl,
                            duration: aiContent.duration,
                            status: aiContent.status ?? "completed",
                            createdAt: aiContent.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                        self.isGenerating = false
                    }
                } else {
                    print("⚠️ No audio URL in response, polling for status...")
                    await pollForPodcastCompletion(token: token)
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isGenerating = false
                    print("❌ Error generating podcast: \(error)")
                }
            }
        }
    }
    
    // MARK: - Regenerate Podcast
    
    private func regeneratePodcast() {
        // Stop and clean up current audio
        stopProgressTimer()
        audioPlayer?.stop()
        audioPlayer = nil
        isPlaying = false
        currentTime = 0
        duration = 0
        
        // Clear current podcast to show generating state
        podcast = nil
        
        // Generate new podcast
        generatePodcast()
    }
    
    private func pollForPodcastCompletion(token: String) async {
        var attempts = 0
        let maxAttempts = 60
        
        while attempts < maxAttempts {
            attempts += 1
            print("🔄 Polling attempt \(attempts)/\(maxAttempts)...")
            
            do {
                try await Task.sleep(nanoseconds: 2_000_000_000)
                
                let aiContent = try await APIService.shared.checkPodcastStatus(token: token, noteId: note.id)
                
                if let aiContent = aiContent, let audioUrl = aiContent.audioUrl {
                    await MainActor.run {
                        self.podcast = Podcast(
                            id: aiContent.id ?? UUID().uuidString,
                            noteId: note.id,
                            audioUrl: audioUrl,
                            duration: aiContent.duration,
                            status: "completed",
                            createdAt: aiContent.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                        self.isGenerating = false
                        print("✅ Podcast ready!")
                    }
                    return
                }
            } catch {
                print("⚠️ Poll error: \(error)")
            }
        }
        
        await MainActor.run {
            self.errorMessage = "Podcast generation timed out. Please try again."
            self.isGenerating = false
            print("⏱️ Polling timed out")
        }
    }
    
    private func statusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "completed": return .green
        case "processing": return .orange
        case "failed": return .accentRed
        default: return .textSecondary
        }
    }
}

// MARK: - Audio Player Delegate

class AudioPlayerDelegate: NSObject, ObservableObject, AVAudioPlayerDelegate {
    var onPlaybackFinished: (() -> Void)?
    
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        print("✅ Playback finished successfully: \(flag)")
        onPlaybackFinished?()
    }
    
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        print("❌ Audio decode error: \(error?.localizedDescription ?? "unknown")")
    }
}
