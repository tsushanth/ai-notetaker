//
//  OnboardingFeatureViews.swift
//  scribeai
//
//  Feature showcase screens for onboarding
//

import SwiftUI

// MARK: - Upload Feature
struct OnboardingFeatureUploadView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @State private var isDragging = false
    @State private var hasDropped = false
    @State private var dragOffset: CGSize = .zero
    @State private var filePosition: CGPoint = .zero
    @State private var dropZoneFrame: CGRect = .zero

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                VStack(spacing: 0) {
                    Spacer()

                    // Title
                    VStack(spacing: 8) {
                        Text("Upload Anything")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text("PDFs  •  YouTube Videos  •  Audio")
                            .font(.system(size: 16))
                            .foregroundColor(.textSecondary)
                    }

                    Spacer()

                    // Drop Zone
                    ZStack {
                        RoundedRectangle(cornerRadius: 20)
                            .strokeBorder(
                                style: StrokeStyle(lineWidth: 2, dash: [10])
                            )
                            .foregroundColor(isDragging ? .purple80 : .purple80.opacity(0.5))
                            .frame(height: 180)
                            .background(
                                RoundedRectangle(cornerRadius: 20)
                                    .fill(isDragging ? Color.purple80.opacity(0.2) : Color.clear)
                            )
                            .scaleEffect(isDragging ? 1.02 : 1.0)

                        VStack(spacing: 12) {
                            Image(systemName: hasDropped ? "checkmark.circle.fill" : "icloud.and.arrow.up")
                                .font(.system(size: 40))
                                .foregroundColor(hasDropped ? .accentGreen : .purple80)

                            Text(hasDropped ? "Uploaded!" : "Drop here")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(hasDropped ? .accentGreen : .purple80)
                        }
                    }
                    .padding(.horizontal, 40)
                    .background(
                        GeometryReader { dropGeo in
                            Color.clear
                                .onAppear {
                                    dropZoneFrame = dropGeo.frame(in: .global)
                                }
                                .onChange(of: dropGeo.frame(in: .global)) { newFrame in
                                    dropZoneFrame = newFrame
                                }
                        }
                    )
                    .animation(.easeInOut, value: isDragging)
                    .animation(.easeInOut, value: hasDropped)

                    Spacer()

                    // Try it out section
                    VStack(spacing: 12) {
                        if !hasDropped {
                            Text("Try it out!")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.textSecondary)

                            Text("Drag the file to the drop zone")
                                .font(.system(size: 14))
                                .foregroundColor(.textTertiary)

                            Image(systemName: "arrow.up")
                                .font(.system(size: 20))
                                .foregroundColor(.purple80)
                                .offset(y: isDragging ? -10 : 0)
                                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: !isDragging && !hasDropped)
                        }

                        // Sample file - placeholder when dragging
                        if isDragging || hasDropped {
                            HStack(spacing: 12) {
                                Image(systemName: "doc.fill")
                                    .font(.system(size: 24))
                                    .foregroundColor(.purple80.opacity(0.3))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Biology")
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(.textPrimary.opacity(0.3))
                                    Text("Cellular Biology")
                                        .font(.system(size: 13))
                                        .foregroundColor(.purple80.opacity(0.3))
                                }

                                Spacer()
                            }
                            .padding(16)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.cardBackground.opacity(0.5), style: StrokeStyle(lineWidth: 2, dash: [5]))
                            )
                            .padding(.horizontal, 60)
                        }
                    }
                    .frame(height: 150)

                    Spacer()

                    // Continue button - disabled until dropped
                    OnboardingPrimaryButton(title: "Continue", isDisabled: !hasDropped) {
                        manager.nextStep()
                    }
                    .padding(.bottom, 32)
                }

                // Draggable file card
                if !hasDropped {
                    DraggableFileCard(
                        isDragging: $isDragging,
                        hasDropped: $hasDropped,
                        dragOffset: $dragOffset,
                        dropZoneFrame: dropZoneFrame
                    )
                    .position(
                        x: geometry.size.width / 2 + dragOffset.width,
                        y: geometry.size.height * 0.75 + dragOffset.height
                    )
                    .opacity(isDragging ? 1 : (hasDropped ? 0 : 1))
                }
            }
        }
    }
}

// MARK: - Draggable File Card
struct DraggableFileCard: View {
    @Binding var isDragging: Bool
    @Binding var hasDropped: Bool
    @Binding var dragOffset: CGSize
    let dropZoneFrame: CGRect

    @State private var cardFrame: CGRect = .zero

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.fill")
                .font(.system(size: 24))
                .foregroundColor(.purple80)

            VStack(alignment: .leading, spacing: 2) {
                Text("Biology")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)
                Text("Cellular Biology")
                    .font(.system(size: 13))
                    .foregroundColor(.purple80)
            }

            Spacer()

            Image(systemName: "line.3.horizontal")
                .font(.system(size: 16))
                .foregroundColor(.textTertiary)
        }
        .padding(16)
        .frame(width: 250)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.cardBackground)
                .shadow(color: isDragging ? Color.purple80.opacity(0.3) : Color.black.opacity(0.2),
                        radius: isDragging ? 12 : 4,
                        y: isDragging ? 8 : 2)
        )
        .scaleEffect(isDragging ? 1.05 : 1.0)
        .gesture(
            DragGesture(coordinateSpace: .global)
                .onChanged { value in
                    withAnimation(.interactiveSpring()) {
                        isDragging = true
                        dragOffset = value.translation
                    }
                }
                .onEnded { value in
                    // Check if dropped in the drop zone
                    let cardCenter = CGPoint(
                        x: value.location.x,
                        y: value.location.y
                    )

                    if dropZoneFrame.contains(cardCenter) {
                        // Successful drop
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                            hasDropped = true
                            isDragging = false
                        }
                        // Haptic feedback
                        let generator = UIImpactFeedbackGenerator(style: .medium)
                        generator.impactOccurred()
                    } else {
                        // Return to original position
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                            isDragging = false
                            dragOffset = .zero
                        }
                    }
                }
        )
        .animation(.interactiveSpring(), value: isDragging)
    }
}

// MARK: - Notes Feature
struct OnboardingFeatureNotesView: View {
    @ObservedObject private var manager = OnboardingManager.shared

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Title
            Text("We'll create beautiful\nnotes for you.")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Spacer()

            // Sample Note Card
            VStack(alignment: .leading, spacing: 16) {
                // Header
                HStack {
                    Image(systemName: "doc.fill")
                        .foregroundColor(.purple80)
                    Text("AP Biology - Cellular Biology")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.textSecondary)
                }

                // Title
                Text("Prokaryotes vs. Eukaryotes")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(.textPrimary)

                // Section
                VStack(alignment: .leading, spacing: 8) {
                    Text("Overview")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.purple80)

                    Text("Cells are categorized into two main groups with distinct structural differences.")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                }

                // Visual comparison
                HStack(spacing: 20) {
                    VStack {
                        ZStack {
                            Circle()
                                .fill(Color.blue.opacity(0.2))
                                .frame(width: 60, height: 60)
                            Image(systemName: "circle.grid.cross")
                                .foregroundColor(.blue)
                        }
                        Text("Prokaryotic Cell")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }

                    VStack {
                        ZStack {
                            Circle()
                                .fill(Color.orange.opacity(0.2))
                                .frame(width: 60, height: 60)
                            Image(systemName: "circle.hexagongrid")
                                .foregroundColor(.orange)
                        }
                        Text("Eukaryotic Cell")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity)

                // Bullet points
                VStack(alignment: .leading, spacing: 6) {
                    Text("Prokaryotic Cells")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    BulletPoint(text: "Simple structure, no nucleus")
                    BulletPoint(text: "DNA floats freely in the cytoplasm")
                    BulletPoint(text: "Example: bacteria")
                }
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.cardBackground)
            )
            .padding(.horizontal, 24)

            Spacer()

            // Continue button
            OnboardingPrimaryButton(title: "Continue") {
                manager.nextStep()
            }
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Flashcards Feature
struct OnboardingFeatureFlashcardsView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @State private var isFlipped = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Title
            VStack(spacing: 8) {
                Text("Master your terms.")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)

                Text("Memorize key concepts with spaced repetition")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)

            Spacer()

            // Flashcard
            ZStack {
                // Back
                FlashcardSide(
                    content: "The process by which plants convert light energy into chemical energy stored in glucose.",
                    isAnswer: true
                )
                .opacity(isFlipped ? 1 : 0)
                .rotation3DEffect(.degrees(isFlipped ? 0 : -180), axis: (x: 0, y: 1, z: 0))

                // Front
                FlashcardSide(
                    content: "Photosynthesis",
                    isAnswer: false
                )
                .opacity(isFlipped ? 0 : 1)
                .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
            }
            .frame(height: 200)
            .padding(.horizontal, 40)
            .onTapGesture {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                    isFlipped.toggle()
                }
            }

            // Tap to flip hint
            HStack {
                Spacer()
                Text("Tap to flip")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.purple80)
            }
            .padding(.horizontal, 40)
            .padding(.top, 12)

            Spacer()

            // Continue button
            OnboardingPrimaryButton(title: "Continue") {
                manager.nextStep()
            }
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Quiz Feature
struct OnboardingFeatureQuizView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @State private var selectedAnswer: Int? = nil
    @State private var showResult = false

    let question = "What is the powerhouse of the cell?"
    let options = ["Nucleus", "Mitochondria", "Ribosome", "Golgi apparatus"]
    let correctAnswer = 1

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Title
            VStack(spacing: 8) {
                Text("Test your knowledge.")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)

                Text("AI-generated quizzes to reinforce learning")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)

            Spacer()

            // Quiz Card
            VStack(alignment: .leading, spacing: 20) {
                // Question
                Text(question)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.textPrimary)

                // Options
                VStack(spacing: 12) {
                    ForEach(0..<options.count, id: \.self) { index in
                        QuizOptionButton(
                            text: options[index],
                            isSelected: selectedAnswer == index,
                            isCorrect: showResult && index == correctAnswer,
                            isIncorrect: showResult && selectedAnswer == index && index != correctAnswer
                        ) {
                            if !showResult {
                                selectedAnswer = index
                                withAnimation(.easeInOut(duration: 0.3).delay(0.2)) {
                                    showResult = true
                                }
                                // Auto advance after showing result
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                    manager.nextStep()
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.cardBackground)
            )
            .padding(.horizontal, 24)

            Spacer()

            // Continue button
            OnboardingPrimaryButton(title: "Continue") {
                manager.nextStep()
            }
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Audio Feature
struct OnboardingFeatureAudioView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @StateObject private var audioPlayer = OnboardingAudioPlayer()

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Title
            VStack(spacing: 8) {
                Text("Learn on the go.")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)

                Text("Turn your materials into engaging audio summaries")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)

            Spacer()

            // Audio Player Card
            VStack(spacing: 20) {
                // Album art with animated waveform
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [Color.purple80.opacity(0.6), Color.blue.opacity(0.4)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 200, height: 200)

                    // Animated waveform when playing
                    if audioPlayer.isPlaying {
                        HStack(spacing: 4) {
                            ForEach(0..<5, id: \.self) { i in
                                WaveformBar(delay: Double(i) * 0.1)
                            }
                        }
                    } else {
                        Image(systemName: "waveform")
                            .font(.system(size: 60))
                            .foregroundColor(.white.opacity(0.8))
                    }
                }

                // Title
                VStack(spacing: 4) {
                    Text("Biology Chapter 3: Cell Structure")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    Text("AI Generated Podcast")
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                }

                // Progress bar
                VStack(spacing: 4) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.white.opacity(0.2))
                                .frame(height: 4)

                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.purple80)
                                .frame(width: geo.size.width * audioPlayer.progress, height: 4)
                        }
                    }
                    .frame(height: 4)

                    HStack {
                        Text(audioPlayer.currentTimeString)
                        Spacer()
                        Text(audioPlayer.durationString)
                    }
                    .font(.system(size: 12))
                    .foregroundColor(.textTertiary)
                }
                .padding(.horizontal, 40)

                // Controls
                HStack(spacing: 40) {
                    Button {
                        audioPlayer.skip(seconds: -10)
                    } label: {
                        Image(systemName: "gobackward.10")
                            .font(.system(size: 24))
                            .foregroundColor(.textSecondary)
                    }

                    Button {
                        audioPlayer.togglePlayPause()
                    } label: {
                        ZStack {
                            Circle()
                                .fill(Color.purple80)
                                .frame(width: 64, height: 64)

                            Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 24))
                                .foregroundColor(.white)
                        }
                    }

                    Button {
                        audioPlayer.skip(seconds: 10)
                    } label: {
                        Image(systemName: "goforward.10")
                            .font(.system(size: 24))
                            .foregroundColor(.textSecondary)
                    }
                }

                // Hint text
                if !audioPlayer.hasStartedPlaying {
                    Text("Tap play to hear a sample")
                        .font(.system(size: 14))
                        .foregroundColor(.purple80)
                }
            }
            .padding(24)

            Spacer()

            // Continue button
            OnboardingPrimaryButton(title: "Continue") {
                audioPlayer.stop()
                manager.nextStep()
            }
            .padding(.bottom, 32)
        }
        .onDisappear {
            audioPlayer.stop()
        }
    }
}

// MARK: - Waveform Animation Bar
struct WaveformBar: View {
    let delay: Double
    @State private var animating = false

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color.white.opacity(0.8))
            .frame(width: 8, height: animating ? 60 : 20)
            .animation(
                Animation.easeInOut(duration: 0.4)
                    .repeatForever(autoreverses: true)
                    .delay(delay),
                value: animating
            )
            .onAppear {
                animating = true
            }
    }
}

// MARK: - Onboarding Audio Player
import AVFoundation

class OnboardingAudioPlayer: NSObject, ObservableObject {
    @Published var isPlaying = false
    @Published var progress: Double = 0.0
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var hasStartedPlaying = false

    private var player: AVAudioPlayer?
    private var timer: Timer?

    var currentTimeString: String {
        formatTime(currentTime)
    }

    var durationString: String {
        formatTime(duration)
    }

    override init() {
        super.init()
        setupAudio()
    }

    private func setupAudio() {
        // Try to load bundled sample audio (try mp3 first, then m4a)
        let audioURL = Bundle.main.url(forResource: "onboarding_sample", withExtension: "mp3")
            ?? Bundle.main.url(forResource: "onboarding_sample", withExtension: "m4a")

        if let url = audioURL {
            do {
                // Configure audio session for playback
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                try AVAudioSession.sharedInstance().setActive(true)

                player = try AVAudioPlayer(contentsOf: url)
                player?.delegate = self
                player?.prepareToPlay()
                duration = player?.duration ?? 0
                print("✅ Loaded onboarding audio: \(url.lastPathComponent), duration: \(duration)s")
            } catch {
                print("❌ Failed to setup audio player: \(error)")
                // Fallback to simulated duration
                duration = 30
            }
        } else {
            print("⚠️ Sample audio not found in bundle, using simulation")
            duration = 30
        }
    }

    func togglePlayPause() {
        if isPlaying {
            pause()
        } else {
            play()
        }
    }

    func play() {
        hasStartedPlaying = true

        if let player = player {
            player.play()
            isPlaying = true
            startTimer()
        } else {
            // Simulate playback if no audio file
            isPlaying = true
            startTimer()
        }
    }

    func pause() {
        player?.pause()
        isPlaying = false
        timer?.invalidate()
    }

    func stop() {
        player?.stop()
        isPlaying = false
        timer?.invalidate()
        currentTime = 0
        progress = 0
    }

    func skip(seconds: Double) {
        if let player = player {
            let newTime = max(0, min(player.duration, player.currentTime + seconds))
            player.currentTime = newTime
            currentTime = newTime
            progress = duration > 0 ? currentTime / duration : 0
        } else {
            // Simulate for demo
            currentTime = max(0, min(duration, currentTime + seconds))
            progress = duration > 0 ? currentTime / duration : 0
        }
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.updateProgress()
        }
    }

    private func updateProgress() {
        if let player = player {
            currentTime = player.currentTime
            progress = duration > 0 ? currentTime / duration : 0
        } else {
            // Simulate playback
            if currentTime < duration {
                currentTime += 0.1
                progress = currentTime / duration
            } else {
                isPlaying = false
                timer?.invalidate()
            }
        }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

extension OnboardingAudioPlayer: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            self.isPlaying = false
            self.timer?.invalidate()
        }
    }
}

// MARK: - Helper Views
struct BulletPoint: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
                .foregroundColor(.textSecondary)
            Text(text)
                .font(.system(size: 13))
                .foregroundColor(.textSecondary)
        }
    }
}

struct FlashcardSide: View {
    let content: String
    let isAnswer: Bool

    var body: some View {
        VStack {
            Spacer()
            Text(content)
                .font(.system(size: isAnswer ? 16 : 24, weight: isAnswer ? .regular : .bold))
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.cardBackground)
        )
    }
}

struct QuizOptionButton: View {
    let text: String
    let isSelected: Bool
    let isCorrect: Bool
    let isIncorrect: Bool
    let action: () -> Void

    var backgroundColor: Color {
        if isCorrect { return Color.accentGreen.opacity(0.2) }
        if isIncorrect { return Color.red.opacity(0.2) }
        if isSelected { return Color.purple80.opacity(0.2) }
        return Color.cardBackground.opacity(0.5)
    }

    var borderColor: Color {
        if isCorrect { return Color.accentGreen }
        if isIncorrect { return Color.red }
        if isSelected { return Color.purple80 }
        return Color.clear
    }

    var body: some View {
        Button(action: action) {
            HStack {
                Text(text)
                    .font(.system(size: 16))
                    .foregroundColor(.textPrimary)

                Spacer()

                if isCorrect {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.accentGreen)
                } else if isIncorrect {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(backgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(borderColor, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Previews
#Preview("Upload") {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingFeatureUploadView()
    }
}

#Preview("Notes") {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingFeatureNotesView()
    }
}

#Preview("Flashcards") {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingFeatureFlashcardsView()
    }
}

#Preview("Quiz") {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingFeatureQuizView()
    }
}

#Preview("Audio") {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingFeatureAudioView()
    }
}
