//
//  AudioRecordingView.swift
//  scribeai
//
//  Audio recording with step-by-step processing UI
//

import SwiftUI
import AVFoundation

struct AudioRecordingView: View {
    @Environment(\.dismiss) var dismiss
    
    // Recording state
    @State private var recordingState: RecordingState = .idle
    @State private var audioRecorder: AVAudioRecorder?
    @State private var recordingURL: URL?
    @State private var recordingDuration: TimeInterval = 0
    @State private var recordingTitle = ""
    @State private var timer: Timer?
    
    // Processing state
    @State private var processingState: ScribeProcessingState = .idle
    @State private var processingSteps: [ScribeProcessingStep] = []
    @State private var currentStepIndex = 0
    @State private var uploadComplete = false
    
    // Permission
    @State private var hasPermission = false
    @State private var showingPermissionAlert = false
    
    // Confirmation alerts
    @State private var showingBackConfirmation = false
    @State private var showingDeleteConfirmation = false
    
    enum RecordingState {
        case idle
        case recording
        case paused
        case reviewing
    }
    
    private var isProcessingIdle: Bool {
        if case .idle = processingState { return true }
        return false
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()
                
                contentView
            }
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        if recordingState == .recording || recordingState == .paused {
                            showingBackConfirmation = true
                        } else {
                            stopAndCleanup()
                            dismiss()
                        }
                    } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.textPrimary)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Record Audio")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.textPrimary)
                        .opacity(isProcessingIdle ? 1 : 0)
                }
            }
            .onAppear {
                checkPermission()
            }
            .onDisappear {
                stopAndCleanup()
            }
            .alert("Discard Recording?", isPresented: $showingBackConfirmation) {
                Button("Keep Recording", role: .cancel) {}
                Button("Discard", role: .destructive) {
                    discardRecording()
                    dismiss()
                }
            } message: {
                Text("You have an active recording. Are you sure you want to leave? Your recording will be lost.")
            }
            .alert("Delete Recording?", isPresented: $showingDeleteConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    discardRecording()
                }
            } message: {
                Text("Are you sure you want to delete this recording? This action cannot be undone.")
            }
        }
        .alert("Microphone Access Required", isPresented: $showingPermissionAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) {
                dismiss()
            }
        } message: {
            Text("Please enable microphone access in Settings to record audio.")
        }
        .navigationViewStyle(.stack)
    }

    // MARK: - Content View
    
    @ViewBuilder
    private var contentView: some View {
        switch processingState {
        case .idle:
            recordingContent
            
        case .processing:
            ScribeProcessingStepsView(
                steps: processingSteps,
                currentIndex: currentStepIndex,
                uploadComplete: uploadComplete
            )
            
        case .success:
            ScribeSuccessView(
                onViewNote: { dismiss() },
                onGoHome: { dismiss() }
            )
            .onAppear {
                AnalyticsService.shared.trackNoteCreated(sourceType: "audio")
            }
            
        case .error(let message):
            ScribeErrorView(
                message: message,
                onRetry: {
                    processingState = .idle
                    recordingState = .idle
                },
                onGoBack: { dismiss() }
            )
            .onAppear {
                AnalyticsService.shared.trackProcessingError(type: "audio", message: message)
            }
        }
    }
    
    // MARK: - Recording Content
    
    @ViewBuilder
    private var recordingContent: some View {
        switch recordingState {
        case .idle:
            idleContent
            
        case .recording, .paused:
            activeRecordingContent
            
        case .reviewing:
            reviewContent
        }
    }
    
    // MARK: - Idle Content
    
    private var idleContent: some View {
        VStack(spacing: 24) {
            Spacer()
            
            Image(systemName: "mic.fill")
                .font(.system(size: 80))
                .foregroundColor(.purple80)
            
            Text("Record Audio")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.textPrimary)
            
            Text("Record lectures, meetings, or notes.\nWe'll transcribe and create study materials.")
                .font(.system(size: 16))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            
            Spacer()
            
            if hasPermission {
                Button {
                    startRecording()
                } label: {
                    ZStack {
                        Circle()
                            .fill(Color.accentRed)
                            .frame(width: 100, height: 100)
                        
                        Image(systemName: "mic.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.white)
                    }
                }
                
                Text("Tap to start recording")
                    .font(.system(size: 14))
                    .foregroundColor(.textSecondary)
            } else {
                Button {
                    requestPermission()
                } label: {
                    HStack {
                        Image(systemName: "mic.fill")
                        Text("Grant Microphone Permission")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .padding(.horizontal, 24)
            }
            
            Spacer()
                .frame(height: 48)
        }
    }
    
    // MARK: - Active Recording Content
    
    private var activeRecordingContent: some View {
        VStack(spacing: 32) {
            Spacer()
            
            // Pulsing indicator
            ZStack {
                Circle()
                    .fill(Color.accentRed.opacity(0.2))
                    .frame(width: 120, height: 120)
                    .scaleEffect(recordingState == .recording ? 1.2 : 1.0)
                    .animation(
                        recordingState == .recording ?
                            .easeInOut(duration: 0.5).repeatForever(autoreverses: true) :
                            .default,
                        value: recordingState
                    )
                
                Circle()
                    .fill(Color.accentRed)
                    .frame(width: 80, height: 80)
                
                Image(systemName: recordingState == .recording ? "mic.fill" : "pause.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.white)
            }
            
            // Duration
            Text(formatDuration(recordingDuration))
                .font(.system(size: 48, weight: .light))
                .foregroundColor(.textPrimary)
                .monospacedDigit()
            
            Text(recordingState == .recording ? "Recording..." : "Paused")
                .font(.system(size: 16))
                .foregroundColor(recordingState == .recording ? .accentRed : .textSecondary)
            
            Spacer()
            
            // Controls
            HStack(spacing: 24) {
                // Discard with confirmation
                Button {
                    showingDeleteConfirmation = true
                } label: {
                    Circle()
                        .stroke(Color.textSecondary, lineWidth: 2)
                        .frame(width: 56, height: 56)
                        .overlay(
                            Image(systemName: "trash")
                                .foregroundColor(.textSecondary)
                        )
                }
                
                // Pause/Resume
                Button {
                    if recordingState == .recording {
                        pauseRecording()
                    } else {
                        resumeRecording()
                    }
                } label: {
                    Circle()
                        .fill(Color.purple80)
                        .frame(width: 72, height: 72)
                        .overlay(
                            Image(systemName: recordingState == .recording ? "pause.fill" : "play.fill")
                                .font(.system(size: 28))
                                .foregroundColor(.white)
                        )
                }
                
                // Stop
                Button {
                    stopRecording()
                } label: {
                    Circle()
                        .fill(Color.accentRed)
                        .frame(width: 56, height: 56)
                        .overlay(
                            Image(systemName: "stop.fill")
                                .font(.system(size: 24))
                                .foregroundColor(.white)
                        )
                }
            }
            
            Spacer()
                .frame(height: 48)
        }
    }
    
    // MARK: - Review Content
    
    private var reviewContent: some View {
        VStack(spacing: 24) {
            Spacer()
                .frame(height: 32)
            
            Image(systemName: "waveform")
                .font(.system(size: 64))
                .foregroundColor(.purple80)
            
            Text("Recording Complete")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(.textPrimary)
            
            Text("Duration: \(formatDuration(recordingDuration))")
                .font(.system(size: 16))
                .foregroundColor(.textSecondary)
            
            // Title input
            ZStack(alignment: .leading) {
                if recordingTitle.isEmpty {
                    Text("Title (optional)")
                        .foregroundColor(Color(white: 0.4))
                        .padding(.leading, 16)
                }
                
                TextField("", text: $recordingTitle)
                    .padding()
                    .foregroundColor(.textPrimary)
            }
            .background(Color.cardBackground)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.darkSurfaceVariant, lineWidth: 1)
            )
            .padding(.horizontal, 24)
            
            Spacer()
            
            // Process button
            Button {
                processRecording()
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                    Text("Process Recording")
                        .font(.system(size: 16, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(Color.purple80)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .padding(.horizontal, 24)
            
            Button {
                showingDeleteConfirmation = true
            } label: {
                Text("Discard Recording")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
            }
            
            Spacer()
                .frame(height: 32)
        }
    }
    
    // MARK: - Recording Functions
    
    private func checkPermission() {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            hasPermission = true
        case .denied:
            hasPermission = false
        case .undetermined:
            hasPermission = false
        @unknown default:
            hasPermission = false
        }
    }
    
    private func requestPermission() {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                hasPermission = granted
                if !granted {
                    showingPermissionAlert = true
                }
            }
        }
    }
    
    private func startRecording() {
        let audioSession = AVAudioSession.sharedInstance()
        
        do {
            try audioSession.setCategory(.playAndRecord, mode: .default)
            try audioSession.setActive(true)
            
            let documentsPath = FileManager.default.temporaryDirectory
            let audioFilename = documentsPath.appendingPathComponent("recording_\(Date().timeIntervalSince1970).m4a")
            recordingURL = audioFilename
            
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100.0,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            
            audioRecorder = try AVAudioRecorder(url: audioFilename, settings: settings)
            audioRecorder?.record()
            
            recordingDuration = 0
            recordingState = .recording
            
            // Track recording started
            AnalyticsService.shared.track(.audioRecorded)
            
            // Start timer
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                recordingDuration += 1
            }
            
        } catch {
            processingState = .error(message: "Failed to start recording: \(error.localizedDescription)")
        }
    }
    
    private func pauseRecording() {
        audioRecorder?.pause()
        timer?.invalidate()
        recordingState = .paused
    }
    
    private func resumeRecording() {
        audioRecorder?.record()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            recordingDuration += 1
        }
        recordingState = .recording
    }
    
    private func stopRecording() {
        audioRecorder?.stop()
        timer?.invalidate()
        recordingState = .reviewing
    }
    
    private func discardRecording() {
        audioRecorder?.stop()
        timer?.invalidate()
        
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        
        recordingURL = nil
        recordingDuration = 0
        recordingTitle = ""
        recordingState = .idle
    }
    
    private func stopAndCleanup() {
        audioRecorder?.stop()
        timer?.invalidate()
    }
    
    // MARK: - Processing
    
    private func processRecording() {
        guard let url = recordingURL,
              let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            processingState = .error(message: "Recording not found or not authenticated")
            return
        }
        
        // Check file exists and has content
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let fileSize = attributes[.size] as? Int64 ?? 0
            print("🎤 Recording file size: \(fileSize) bytes")
            
            if fileSize < 1000 {
                processingState = .error(message: "Recording is too short. Please record for longer.")
                return
            }
        } catch {
            processingState = .error(message: "Cannot read recording file")
            return
        }
        
        // Initialize processing steps
        processingSteps = ScribeRecordingStep.allCases.map {
            ScribeProcessingStep(title: $0.title, status: .pending)
        }
        currentStepIndex = 0
        uploadComplete = false
        processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
        
        Task {
            do {
                // Step 1: Uploading
                await updateStep(at: 0, to: .inProgress)
                
                let recording = try await APIService.shared.uploadRecording(
                    token: token,
                    fileURL: url,
                    title: recordingTitle.isEmpty ? nil : recordingTitle
                )
                
                await updateStep(at: 0, to: .completed)
                await MainActor.run { uploadComplete = true }
                
                // Step 2: Transcribing
                await updateStep(at: 1, to: .inProgress)
                
                let result = try await APIService.shared.transcribeRecording(token: token, recordingId: recording.id)
                
                await updateStep(at: 1, to: .completed)
                
                // Animate through remaining steps
                for i in 2..<processingSteps.count {
                    await updateStep(at: i, to: .inProgress)
                    try await Task.sleep(nanoseconds: 800_000_000)
                    await updateStep(at: i, to: .completed)
                }
                
                // Clean up temp file
                try? FileManager.default.removeItem(at: url)
                
                await MainActor.run {
                    processingState = .success(noteId: result.noteId)
                }
                
            } catch APIError.timeout {
                await MainActor.run {
                    processingState = .error(message: "Transcription is taking too long. Please try a shorter recording or try again later.")
                }
            } catch APIError.unauthorized {
                await MainActor.run {
                    processingState = .error(message: "Session expired. Please log in again.")
                }
            } catch {
                await MainActor.run {
                    let errorMessage: String

                    // Handle network errors with enhanced messaging
                    if let apiError = error as? APIError,
                       case .networkError(let message, let isRetryable) = apiError {
                        errorMessage = isRetryable
                            ? "\(message)\n\nYour recording was saved locally."
                            : message
                        print("❌ Network error (retryable: \(isRetryable)): \(message)")
                    } else if let apiError = error as? APIError {
                        errorMessage = apiError.localizedDescription
                    } else {
                        errorMessage = error.localizedDescription
                    }

                    print("❌ Processing error: \(errorMessage)")
                    processingState = .error(message: errorMessage)
                    ErrorReportingService.shared.reportError(flow: .recordAudio, error: error)
                }
            }
        }
    }
    
    @MainActor
    private func updateStep(at index: Int, to status: ScribeProcessingStep.ScribeStepStatus) {
        guard index < processingSteps.count else { return }
        processingSteps[index].status = status
        currentStepIndex = index
        processingState = .processing(steps: processingSteps, currentIndex: index, uploadComplete: uploadComplete)
    }
    
    // MARK: - Helpers
    
    private func formatDuration(_ duration: TimeInterval) -> String {
        let hours = Int(duration) / 3600
        let minutes = (Int(duration) % 3600) / 60
        let seconds = Int(duration) % 60
        
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%02d:%02d", minutes, seconds)
        }
    }
}

#Preview {
    AudioRecordingView()
}
