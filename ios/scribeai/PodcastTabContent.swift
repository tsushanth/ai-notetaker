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
    @State private var showPaywall = false
    @State private var selectedDuration: String = "short"
    @State private var selectedGender: VoiceGender = .female
    @State private var selectedVoice: PodcastVoice = .sarah
    @State private var specialInstructions: String = ""
    @State private var showInstructionsField = false
    @FocusState private var isInstructionsFocused: Bool

    // Audio progress tracking
    @State private var currentTime: TimeInterval = 0
    @State private var audioDuration: TimeInterval = 0
    @State private var progressTimer: Timer?
    @State private var isDragging = false

    // Audio delegate for playback completion
    @StateObject private var audioDelegate = AudioPlayerDelegate()

    private let durationOptions: [(id: String, label: String, description: String)] = [
        ("short", "Short", "3-5 min"),
        ("medium", "Medium", "8-12 min"),
        ("long", "Long", "15-20 min")
    ]

    // Gender options for narrator
    enum VoiceGender: String, CaseIterable {
        case female = "female"
        case male = "male"

        var displayName: String {
            switch self {
            case .female: return "Female"
            case .male: return "Male"
            }
        }

        var voices: [PodcastVoice] {
            switch self {
            case .female: return [.sarah, .emily]
            case .male: return [.james, .daniel, .marcus]
            }
        }

        var defaultVoice: PodcastVoice {
            switch self {
            case .female: return .sarah
            case .male: return .james
            }
        }
    }

    // Voice options - matches TTS voices with human names
    enum PodcastVoice: String, CaseIterable {
        case sarah = "nova"
        case emily = "shimmer"
        case james = "echo"
        case daniel = "fable"
        case marcus = "onyx"

        var displayName: String {
            switch self {
            case .sarah: return "Sarah"
            case .emily: return "Emily"
            case .james: return "James"
            case .daniel: return "Daniel"
            case .marcus: return "Marcus"
            }
        }

        var gender: VoiceGender {
            switch self {
            case .sarah, .emily: return .female
            case .james, .daniel, .marcus: return .male
            }
        }
    }
    
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
                                in: 0...max(audioDuration, 1),
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
                                
                                Text(formatTime(audioDuration))
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
                // Generate Podcast UI with inline options
                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 12) {
                            Image(systemName: "waveform.circle.fill")
                                .font(.system(size: 60))
                                .foregroundColor(.purple80)

                            Text("Create Podcast")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundColor(.textPrimary)

                            Text("Transform your notes into an engaging conversation")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 20)

                        // Duration Section
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                Image(systemName: "clock")
                                    .font(.system(size: 14))
                                    .foregroundColor(.textSecondary)
                                Text("Duration")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundColor(.textPrimary)
                            }

                            // Duration options as horizontal buttons
                            HStack(spacing: 12) {
                                ForEach(durationOptions, id: \.id) { option in
                                    DurationOptionButton(
                                        id: option.id,
                                        label: option.label,
                                        description: option.description,
                                        isSelected: selectedDuration == option.id
                                    ) {
                                        selectedDuration = option.id
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 20)

                        // Voice Selection Section - Two dropdowns side by side
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                Image(systemName: "person.wave.2")
                                    .font(.system(size: 14))
                                    .foregroundColor(.textSecondary)
                                Text("Narrator Voices")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundColor(.textPrimary)
                            }

                            // Two dropdowns side by side - Female and Male
                            HStack(spacing: 12) {
                                // Female voices dropdown
                                VoiceDropdown(
                                    label: "Female",
                                    voices: VoiceGender.female.voices,
                                    selectedVoice: selectedGender == .female ? selectedVoice : nil,
                                    isSelected: selectedGender == .female
                                ) { voice in
                                    selectedGender = .female
                                    selectedVoice = voice
                                }

                                // Male voices dropdown
                                VoiceDropdown(
                                    label: "Male",
                                    voices: VoiceGender.male.voices,
                                    selectedVoice: selectedGender == .male ? selectedVoice : nil,
                                    isSelected: selectedGender == .male
                                ) { voice in
                                    selectedGender = .male
                                    selectedVoice = voice
                                }
                            }
                        }
                        .padding(.horizontal, 20)

                        // Instructions Button/Field (Expandable)
                        VStack(alignment: .leading, spacing: 12) {
                            if showInstructionsField {
                                HStack {
                                    HStack(spacing: 8) {
                                        Image(systemName: "square.and.pencil")
                                            .font(.system(size: 14))
                                            .foregroundColor(.textSecondary)
                                        Text("Instructions")
                                            .font(.system(size: 15, weight: .medium))
                                            .foregroundColor(.textPrimary)
                                    }

                                    Spacer()

                                    Button {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            showInstructionsField = false
                                            specialInstructions = ""
                                        }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 18))
                                            .foregroundColor(.textTertiary)
                                    }
                                }

                                TextField("Describe any specific focus or style...", text: $specialInstructions, axis: .vertical)
                                    .font(.system(size: 15))
                                    .foregroundColor(.textPrimary)
                                    .lineLimit(2...4)
                                    .padding(14)
                                    .background(Color.cardBackground)
                                    .cornerRadius(12)
                                    .focused($isInstructionsFocused)
                            } else {
                                Button {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        showInstructionsField = true
                                    }
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                        isInstructionsFocused = true
                                    }
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "plus.circle")
                                            .font(.system(size: 14))
                                        Text("Add instructions")
                                            .font(.system(size: 14, weight: .medium))

                                        Spacer()

                                        Text("OPTIONAL")
                                            .font(.system(size: 10, weight: .semibold))
                                            .foregroundColor(.textTertiary)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(Color.darkSurfaceVariant)
                                            .cornerRadius(4)
                                    }
                                    .foregroundColor(.purple80)
                                    .padding(14)
                                    .background(Color.cardBackground)
                                    .cornerRadius(12)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.purple80.opacity(0.3), lineWidth: 1)
                                )
                            }
                                .buttonStyle(PlainButtonStyle())
                            }
                        }
                        .padding(.horizontal, 20)

                        if let error = errorMessage {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.accentRed)
                                .padding()
                                .background(Color.accentRed.opacity(0.1))
                                .cornerRadius(8)
                                .padding(.horizontal, 20)
                        }

                        // Generate Button
                        Button(action: {
                            if let _ = KeychainService.shared.get(Constants.Keychain.accessToken) {
                                isInstructionsFocused = false
                                let instructions = specialInstructions.trimmingCharacters(in: .whitespacesAndNewlines)
                                generatePodcast(duration: selectedDuration, gender: selectedGender.rawValue, instructions: instructions.isEmpty ? nil : instructions)
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
                                Text(isGenerating ? "Generating..." : "Generate Podcast")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(isGenerating ? Color.purple80.opacity(0.6) : Color.purple80)
                            .foregroundColor(.white)
                            .cornerRadius(28)
                        }
                        .disabled(isGenerating)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .onAppear {
            AnalyticsService.shared.trackPodcastTabViewed(noteId: note.id)
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
            Button("Continue", role: .destructive) {
                regeneratePodcast()
            }
        } message: {
            Text("You'll be able to select new voice options before generating.")
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                ScribeRemotePaywallView(triggerSource: "podcast_feature_gate") {
                    showPaywall = false
                    Task {
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                }
            }
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
                // Track pause
                AnalyticsService.shared.trackPodcastPlayPaused(
                    podcastId: podcast.id,
                    currentPosition: Int(currentTime),
                    duration: Int(audioDuration)
                )
            } else {
                player.play()
                isPlaying = true
                startProgressTimer()
                // Track resume (first play is tracked in loadAndPlayAudio)
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

                // Track podcast play completed
                if let podcast = self.podcast {
                    AnalyticsService.shared.trackPodcastPlayCompleted(
                        podcastId: podcast.id,
                        duration: Int(self.audioDuration)
                    )
                }
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
                        self.audioDuration = player.duration
                        self.currentTime = 0
                        
                        player.play()
                        self.isPlaying = true
                        self.isBuffering = false

                        startProgressTimer()

                        // Track play started
                        if let podcast = self.podcast {
                            AnalyticsService.shared.trackPodcastPlayStarted(
                                podcastId: podcast.id,
                                duration: Int(player.duration)
                            )
                        }

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

        // Track skip
        AnalyticsService.shared.trackPodcastSkipped(
            direction: seconds > 0 ? "forward" : "backward",
            skipSeconds: abs(Int(seconds))
        )
    }
    
    // MARK: - Progress Timer
    
    private func startProgressTimer() {
        stopProgressTimer()
        
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            guard let player = audioPlayer, !isDragging else { return }
            
            currentTime = player.currentTime
            
            if !player.isPlaying && currentTime >= audioDuration - 0.5 {
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

    private func generatePodcast(duration: String = "short", gender: String = "female", instructions: String? = nil) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }

        AnalyticsService.shared.trackPodcastGenerateStarted(noteId: note.id)
        isGenerating = true
        errorMessage = nil

        print("🎙️ Starting podcast generation for note: \(note.id) with gender: \(gender), duration: \(duration)")

        Task {
            do {
                print("📤 Calling generatePodcast API...")
                let aiContent = try await APIService.shared.generatePodcast(
                    token: token,
                    noteId: note.id,
                    contentLength: note.content.count,
                    duration: duration,
                    gender: gender,
                    instructions: instructions
                )
                
                print("✅ API returned: \(aiContent)")
                
                if let audioUrl = aiContent.audioUrl {
                    let durationSeconds = Int(self.audioDuration)
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
                        // Trigger post-value paywall prompt after AI content generated
                        PostValueTrialManager.shared.checkAndTriggerPrompt()
                    }
                } else {
                    print("⚠️ No audio URL in response, polling for status...")
                    await pollForPodcastCompletion(token: token)
                }
            } catch let error as APIError {
                await MainActor.run {
                    self.isGenerating = false
                    switch error {
                    case .subscriptionRequired, .freeTierLimitReached:
                        print("🔐 Subscription required for podcast")
                        self.showPaywall = true
                    default:
                        self.errorMessage = error.localizedDescription
                        print("❌ Error generating podcast: \(error)")
                    }
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
        audioDuration = 0

        // Clear current podcast to show generation view (user can select voices)
        podcast = nil
    }
    
    private func pollForPodcastCompletion(token: String) async {
        var attempts = 0
        let maxAttempts = 90  // Increased to 3 minutes (90 * 2 seconds)

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
                // If we get a specific error, stop polling
                if let apiError = error as? APIError {
                    switch apiError {
                    case .unauthorized:
                        await MainActor.run {
                            self.errorMessage = "Session expired. Please try again."
                            self.isGenerating = false
                        }
                        return
                    default:
                        break
                    }
                }
            }
        }

        await MainActor.run {
            self.errorMessage = "Podcast generation is taking longer than expected. Try loading this note again in a few minutes."
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

// MARK: - Duration Option Button

struct DurationOptionButton: View {
    let id: String
    let label: String
    let description: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(isSelected ? .purple80 : .textPrimary)

                Text(description)
                    .font(.system(size: 11))
                    .foregroundColor(isSelected ? .purple80 : .textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(isSelected ? Color.purple80.opacity(0.15) : Color.cardBackground)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Voice Dropdown

struct VoiceDropdown: View {
    let label: String
    let voices: [PodcastTabContent.PodcastVoice]
    let selectedVoice: PodcastTabContent.PodcastVoice?
    let isSelected: Bool
    let onSelect: (PodcastTabContent.PodcastVoice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(isSelected ? .purple80 : .textSecondary)

            Menu {
                ForEach(voices, id: \.rawValue) { voice in
                    Button(action: {
                        onSelect(voice)
                    }) {
                        HStack {
                            Text(voice.displayName)
                            if selectedVoice == voice {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                HStack {
                    Text(selectedVoice?.displayName ?? voices.first?.displayName ?? "Select")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(isSelected ? .purple80 : .textPrimary)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(isSelected ? .purple80 : .textSecondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
                .background(isSelected ? Color.purple80.opacity(0.15) : Color.cardBackground)
                .cornerRadius(10)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(isSelected ? Color.purple80 : Color.darkSurfaceVariant, lineWidth: isSelected ? 2 : 1)
                )
            }
        }
        .frame(maxWidth: .infinity)
    }
}
