//
//  ChatTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//

import SwiftUI
import AVFoundation
import Speech

struct ChatTabContent: View {
    let note: Note
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isLoading = false
    @State private var isVoiceMode = false
    @State private var isListening = false
    @State private var isSpeaking = false

    // Suggestions state
    @State private var suggestions: [String] = []
    @State private var isLoadingSuggestions = false
    @State private var showSuggestions = false

    @StateObject private var speechRecognizer = SpeechRecognizer()
    @StateObject private var speechSynthesizer = SpeechSynthesizer()
    
    var body: some View {
        VStack(spacing: 0) {
            // Mode Toggle Header
            HStack {
                Image(systemName: isVoiceMode ? "waveform" : "message.fill")
                    .foregroundColor(isVoiceMode ? .purple80 : .textSecondary)
                
                Text(isVoiceMode ? "Voice Conversation Mode" : "Text Chat Mode")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(isVoiceMode ? .purple80 : .textPrimary)
                
                Spacer()
                
                Toggle("", isOn: $isVoiceMode)
                    .labelsHidden()
                    .tint(.purple80)
                    .onChange(of: isVoiceMode) { newValue in
                        if !newValue {
                            speechSynthesizer.stop()
                            isSpeaking = false
                        }
                    }
            }
            .padding()
            .background(Color.cardBackground)
            
            if messages.isEmpty {
                // Empty state
                VStack(spacing: 16) {
                    Spacer()

                    Image(systemName: isVoiceMode ? "waveform.circle.fill" : "message.fill")
                        .font(.system(size: 64))
                        .foregroundColor(.purple80)

                    Text(isVoiceMode ? "Have a voice conversation" : "Ask anything about your notes")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.textPrimary)
                        .multilineTextAlignment(.center)

                    Text(isVoiceMode ? "Tap the microphone to start talking. I'll respond with voice too!" : "Type or use voice to ask questions")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)

                    // Suggestions Section
                    if showSuggestions {
                        suggestionsView
                            .padding(.top, 16)
                    } else {
                        Button(action: {
                            loadSuggestions()
                        }) {
                            HStack(spacing: 8) {
                                Image(systemName: "lightbulb.fill")
                                    .font(.system(size: 14))
                                Text("Show Suggestions")
                                    .font(.system(size: 14, weight: .medium))
                            }
                            .foregroundColor(.purple80)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(Color.purple80.opacity(0.15))
                            .cornerRadius(20)
                        }
                        .padding(.top, 16)
                    }

                    Spacer()
                }
            } else {
                // Messages List
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(messages) { message in
                                ChatMessageRow(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _ in
                        if let lastMessage = messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMessage.id, anchor: .bottom)
                            }
                        }
                    }
                }
            }
            
            // Voice Mode Status Bar
            if isVoiceMode {
                VoiceModeStatusBar(
                    isListening: isListening,
                    isSpeaking: isSpeaking,
                    isLoading: isLoading
                )
            }
            
            // Loading Indicator (for text mode)
            if !isVoiceMode && isLoading {
                HStack {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(0.8)
                    Text("Thinking...")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                }
                .padding(.vertical, 8)
            }
            
            // Input Area
            if isVoiceMode {
                VoiceModeInput(
                    isListening: isListening,
                    isSpeaking: isSpeaking,
                    isLoading: isLoading,
                    onStartListening: {
                        startListening()
                    },
                    onStopListening: {
                        stopListening()
                    },
                    onStopSpeaking: {
                        speechSynthesizer.stop()
                        isSpeaking = false
                    }
                )
            } else {
                TextModeInput(
                    inputText: $inputText,
                    isLoading: isLoading,
                    isListening: isListening,
                    onSend: {
                        sendMessage(inputText)
                    },
                    onVoiceInput: {
                        startListening()
                    },
                    onStopListening: {
                        stopListening()
                    }
                )
            }
        }
        .onAppear {
            // Track chat tab viewed
            AnalyticsService.shared.trackChatTabViewed(noteId: note.id)
            // Ensure clean state
            speechRecognizer.stopRecording()
        }
        .onDisappear {
            // Clean up audio resources
            speechRecognizer.stopRecording()
            speechSynthesizer.stop()
        }
    }
    
    private func startListening() {
        guard !isLoading && !isSpeaking && !isListening else { return }
        
        isListening = true
        speechRecognizer.startRecording { result in
            DispatchQueue.main.async {
                self.isListening = false
                
                switch result {
                case .success(let text):
                    if !text.isEmpty {
                        if self.isVoiceMode {
                            // Auto-send in voice mode
                            self.sendMessage(text, speakResponse: true)
                        } else {
                            // Fill input in text mode
                            self.inputText = text
                        }
                    }
                case .failure(let error):
                    print("❌ Speech recognition error: \(error.localizedDescription)")
                    // Show error to user
                    self.showSpeechError(error.localizedDescription)
                }
            }
        }
    }
    
    private func stopListening() {
        guard isListening else { return }
        speechRecognizer.stopRecording()
        // isListening will be set to false by the completion handler
    }
    
    private func showSpeechError(_ message: String) {
        let displayMessage: String
        
        if message.contains("physical device") || message.contains("simulator") {
            displayMessage = "⚠️ Voice features require a real iPhone or iPad. The iOS Simulator doesn't support voice recognition."
        } else if message.contains("permission denied") {
            displayMessage = "🎤 Please enable microphone and speech recognition permissions in Settings → Privacy & Security."
        } else if message.contains("canceled") {
            // Don't show error for normal cancellation
            return
        } else {
            displayMessage = "Voice input error: \(message)"
        }
        
        let errorMessage = ChatMessage(
            id: UUID().uuidString,
            role: "assistant",
            text: displayMessage
        )
        messages.append(errorMessage)
    }
    
    private func sendMessage(_ text: String, speakResponse: Bool = false) {
        guard !text.isEmpty else { return }

        // Track chat message sent
        AnalyticsService.shared.trackChatMessageSent(noteId: note.id, messageLength: text.count)
        
        let userMessage = ChatMessage(id: UUID().uuidString, role: "user", text: text)
        messages.append(userMessage)
        inputText = ""
        isLoading = true
        
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            isLoading = false
            return
        }
        
        Task {
            do {
                let conversationHistory: [ChatHistoryItem] = messages.dropLast().map { msg in
                    ChatHistoryItem(text: msg.text, isUser: msg.isUser)
                }
                
                let response = try await APIService.shared.chatWithNote(
                    token: token,
                    noteId: note.id,
                    question: text,
                    conversationHistory: Array(conversationHistory),
                    contentLength: note.content.count
                )
                
                await MainActor.run {
                    let aiMessage = ChatMessage(id: UUID().uuidString, role: "assistant", text: response.answer)
                    messages.append(aiMessage)
                    isLoading = false

                    // Speak response in voice mode
                    if speakResponse && isVoiceMode {
                        speakText(response.answer)
                    }

                    // Trigger post-value paywall prompt after AI chat response
                    PostValueTrialManager.shared.checkAndTriggerPrompt()
                }
            } catch {
                await MainActor.run {
                    let errorMessage = ChatMessage(
                        id: UUID().uuidString,
                        role: "assistant",
                        text: "Sorry, I encountered an error: \(error.localizedDescription)"
                    )
                    messages.append(errorMessage)
                    isLoading = false
                }
            }
        }
    }
    
    private func speakText(_ text: String) {
        isSpeaking = true
        speechSynthesizer.speak(text) {
            DispatchQueue.main.async {
                self.isSpeaking = false
            }
        }
    }

    // MARK: - Suggestions

    private var suggestionsView: some View {
        VStack(spacing: 12) {
            if isLoadingSuggestions {
                HStack(spacing: 8) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(0.8)
                    Text("Loading suggestions...")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                }
                .padding(.vertical, 20)
            } else if suggestions.isEmpty {
                Text("No suggestions available")
                    .font(.system(size: 14))
                    .foregroundColor(.textSecondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(Array(suggestions.enumerated()), id: \.element) { index, suggestion in
                        Button(action: {
                            // Track suggestion used
                            AnalyticsService.shared.trackChatSuggestionUsed(noteId: note.id, suggestionIndex: index)
                            inputText = suggestion
                            sendMessage(suggestion)
                        }) {
                            HStack {
                                Text(suggestion)
                                    .font(.system(size: 14))
                                    .foregroundColor(.textPrimary)
                                    .multilineTextAlignment(.leading)
                                    .lineLimit(2)

                                Spacer()

                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(.purple80)
                            }
                            .padding(12)
                            .background(Color.cardBackground)
                            .cornerRadius(12)
                        }
                    }
                }
                .padding(.horizontal, 24)
            }
        }
    }

    private func loadSuggestions() {
        guard !isLoadingSuggestions else { return }

        showSuggestions = true
        isLoadingSuggestions = true

        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            isLoadingSuggestions = false
            return
        }

        Task {
            do {
                let fetchedSuggestions = try await APIService.shared.getChatSuggestions(
                    token: token,
                    noteId: note.id
                )

                await MainActor.run {
                    suggestions = fetchedSuggestions
                    isLoadingSuggestions = false
                }
            } catch {
                await MainActor.run {
                    print("❌ Failed to load suggestions: \(error)")
                    isLoadingSuggestions = false
                    // Show fallback suggestions
                    suggestions = [
                        "What are the main concepts in these notes?",
                        "Can you summarize the key points?",
                        "What should I focus on for an exam?"
                    ]
                }
            }
        }
    }
}

struct ChatMessageRow: View {
    let message: ChatMessage
    
    var body: some View {
        HStack {
            if message.isUser { Spacer() }
            
            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                Text(message.text)
                    .font(.system(size: 15))
                    .foregroundColor(message.isUser ? .white : .textPrimary)
                    .padding(12)
                    .background(message.isUser ? Color.purple80 : Color.cardBackground)
                    .cornerRadius(16)
                
                Text(formatTime(message.timestamp))
                    .font(.system(size: 11))
                    .foregroundColor(.textTertiary)
            }
            .frame(maxWidth: .infinity * 0.75, alignment: message.isUser ? .trailing : .leading)
            
            if !message.isUser { Spacer() }
        }
    }
    
    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

struct VoiceModeStatusBar: View {
    let isListening: Bool
    let isSpeaking: Bool
    let isLoading: Bool
    
    var body: some View {
        if isListening || isSpeaking || isLoading {
            HStack(spacing: 12) {
                if isListening {
                    // Animated listening indicator
                    HStack(spacing: 4) {
                        ForEach(0..<3) { index in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.purple80)
                                .frame(width: 4, height: 20)
                                .scaleEffect(y: 1.0, anchor: .center)
                                .animation(
                                    Animation
                                        .easeInOut(duration: 0.5)
                                        .repeatForever()
                                        .delay(Double(index) * 0.15),
                                    value: isListening
                                )
                        }
                    }
                    Text("Listening... tap stop to finish")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.purple80)
                } else if isSpeaking {
                    Image(systemName: "speaker.wave.2.fill")
                        .foregroundColor(.purple80)
                    Text("Speaking...")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.purple80)
                } else if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(0.8)
                    Text("Thinking...")
                        .font(.system(size: 15))
                        .foregroundColor(.textSecondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.purple80.opacity(isListening || isSpeaking ? 0.15 : 0.05))
        }
    }
}

struct VoiceModeInput: View {
    let isListening: Bool
    let isSpeaking: Bool
    let isLoading: Bool
    let onStartListening: () -> Void
    let onStopListening: () -> Void
    let onStopSpeaking: () -> Void
    
    var body: some View {
        VStack {
            if isSpeaking {
                Button(action: onStopSpeaking) {
                    ZStack {
                        Circle()
                            .fill(Color.accentRed)
                            .frame(width: 80, height: 80)
                        
                        Image(systemName: "stop.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)
                    }
                }
                
                Text("Tap to stop speaking")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .padding(.top, 8)
            } else if isListening {
                // Show stop button when listening
                Button(action: onStopListening) {
                    ZStack {
                        // Outer pulsing circle
                        Circle()
                            .fill(Color.accentRed.opacity(0.3))
                            .frame(width: 100, height: 100)
                            .scaleEffect(1.2)
                            .opacity(0.5)
                            .animation(
                                Animation.easeOut(duration: 1.0).repeatForever(autoreverses: false),
                                value: isListening
                            )
                        
                        // Stop button
                        Circle()
                            .fill(Color.accentRed)
                            .frame(width: 80, height: 80)
                        
                        Image(systemName: "stop.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)
                    }
                }
                
                Text("Tap to stop recording")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .padding(.top, 8)
            } else {
                // Show mic button when idle
                Button(action: onStartListening) {
                    ZStack {
                        Circle()
                            .fill(Color.purple80)
                            .frame(width: 80, height: 80)
                        
                        Image(systemName: "mic.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)
                    }
                }
                .disabled(isLoading)
                .opacity(isLoading ? 0.5 : 1.0)
                
                Text("Tap to start recording")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .background(Color.cardBackground)
    }
}

struct TextModeInput: View {
    @Binding var inputText: String
    let isLoading: Bool
    let isListening: Bool
    let onSend: () -> Void
    let onVoiceInput: () -> Void
    let onStopListening: () -> Void
    
    var body: some View {
        HStack(spacing: 12) {
            Button(action: {
                if isListening {
                    onStopListening()
                } else {
                    onVoiceInput()
                }
            }) {
                ZStack {
                    if isListening {
                        Circle()
                            .fill(Color.accentRed.opacity(0.3))
                            .frame(width: 44, height: 44)
                            .scaleEffect(1.3)
                            .opacity(0.5)
                            .animation(
                                Animation.easeOut(duration: 1.0).repeatForever(autoreverses: false),
                                value: isListening
                            )
                        
                        Circle()
                            .fill(Color.accentRed)
                            .frame(width: 36, height: 36)
                        
                        Image(systemName: "stop.fill")
                            .font(.system(size: 16))
                            .foregroundColor(.white)
                    } else {
                        Image(systemName: "mic.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(isLoading ? .textTertiary : .purple80)
                    }
                }
            }
            .disabled(isLoading)
            
            // FIXED: Custom placeholder for visibility on dark background
            ZStack(alignment: .leading) {
                if inputText.isEmpty {
                    Text("Ask a question...")
                        .foregroundColor(Color(white: 0.4))
                        .padding(.leading, 16)
                }
                
                TextField("", text: $inputText)
                    .padding(12)
                    .foregroundColor(.textPrimary)
                    .disabled(isLoading || isListening)
                    .onSubmit {
                        onSend()
                    }
            }
            .background(Color.cardBackground)
            .cornerRadius(20)
            
            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(inputText.isEmpty || isLoading || isListening ? .textTertiary : .purple80)
            }
            .disabled(inputText.isEmpty || isLoading || isListening)
        }
        .padding()
        .background(Color.darkBackground)
        .overlay(
            Group {
                if isListening {
                    VStack {
                        Text("Listening... tap stop button")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.accentRed)
                            .cornerRadius(12)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, -40)
                }
            }
        )
    }
}




// MARK: - Speech Recognition Helper

class SpeechRecognizer: NSObject, ObservableObject, SFSpeechRecognizerDelegate {
    private let speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private var isRecording = false
    private var completionHandler: ((Result<String, Error>) -> Void)?
    private var currentTranscription = ""
    
    // Check if running on simulator
    private var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
    
    override init() {
        self.speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        super.init()
        self.speechRecognizer?.delegate = self
    }
    
    func startRecording(completion: @escaping (Result<String, Error>) -> Void) {
        // Check if running on simulator
        if isSimulator {
            completion(.failure(NSError(
                domain: "SpeechRecognizer",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Voice features require a physical device. Please test on a real iPhone or iPad."]
            )))
            return
        }
        
        // Prevent multiple simultaneous recordings
        guard !isRecording else {
            completion(.failure(NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Already recording"])))
            return
        }
        
        // Check if speech recognizer is available
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            completion(.failure(NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition not available on this device"])))
            return
        }
        
        // Store completion handler
        self.completionHandler = completion
        self.currentTranscription = ""
        
        // Request authorization
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    do {
                        try self?.startRecordingInternal()
                    } catch {
                        self?.isRecording = false
                        self?.completionHandler?(.failure(error))
                        self?.completionHandler = nil
                    }
                case .denied:
                    self?.completionHandler?(.failure(NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition permission denied. Please enable it in Settings → Privacy & Security → Speech Recognition."])))
                    self?.completionHandler = nil
                case .restricted:
                    self?.completionHandler?(.failure(NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition is restricted on this device"])))
                    self?.completionHandler = nil
                case .notDetermined:
                    self?.completionHandler?(.failure(NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition permission not determined"])))
                    self?.completionHandler = nil
                @unknown default:
                    self?.completionHandler?(.failure(NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unknown speech recognition status"])))
                    self?.completionHandler = nil
                }
            }
        }
    }
    
    private func startRecordingInternal() throws {
        // Cancel previous task if any
        recognitionTask?.cancel()
        recognitionTask = nil
        
        isRecording = true
        
        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            isRecording = false
            throw NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to configure audio session: \(error.localizedDescription)"])
        }
        
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else {
            isRecording = false
            throw NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unable to create recognition request"])
        }
        
        recognitionRequest.shouldReportPartialResults = true
        
        let inputNode = audioEngine.inputNode
        
        // CRITICAL: Remove any existing tap before installing a new one
        inputNode.removeTap(onBus: 0)
        
        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }
            
            if let result = result {
                // Store the latest transcription
                self.currentTranscription = result.bestTranscription.formattedString
                
                if result.isFinal {
                    self.finishRecording(withText: self.currentTranscription)
                }
            }
            
            if let error = error {
                print("Recognition error: \(error.localizedDescription)")
                
                // Don't report "canceled" as an error if we got a successful result
                let nsError = error as NSError
                if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 216 {
                    // Recognition was canceled - return whatever we have
                    self.finishRecording(withText: self.currentTranscription)
                } else if self.isRecording {
                    self.finishRecording(withError: error)
                }
            }
        }
        
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        // Validate recording format
        guard recordingFormat.sampleRate > 0 && recordingFormat.channelCount > 0 else {
            isRecording = false
            throw NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid audio format"])
        }
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }
        
        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            isRecording = false
            throw NSError(domain: "SpeechRecognizer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to start audio engine: \(error.localizedDescription)"])
        }
        
        print("✅ Started recording")
        
        // Auto-stop after 30 seconds (increased from 10)
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self = self, self.isRecording else { return }
            print("⏱️ Auto-stopping after 30 seconds")
            self.stopRecording()
        }
    }
    
    private func finishRecording(withText text: String) {
        guard isRecording else { return }
        
        cleanupRecording()
        
        DispatchQueue.main.async {
            self.completionHandler?(.success(text))
            self.completionHandler = nil
        }
    }
    
    private func finishRecording(withError error: Error) {
        guard isRecording else { return }
        
        cleanupRecording()
        
        DispatchQueue.main.async {
            self.completionHandler?(.failure(error))
            self.completionHandler = nil
        }
    }
    
    private func cleanupRecording() {
        print("🛑 Cleaning up recording")
        isRecording = false
        
        // Stop audio engine
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        
        // Remove tap
        audioEngine.inputNode.removeTap(onBus: 0)
        
        // End recognition
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        
        recognitionTask?.finish()
        recognitionTask = nil
        
        // Deactivate audio session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Error deactivating audio session: \(error)")
        }
    }
    
    func stopRecording() {
        guard isRecording else { return }
        
        print("🛑 User stopped recording")
        
        // Return whatever transcription we have so far
        let text = currentTranscription
        cleanupRecording()
        
        DispatchQueue.main.async {
            self.completionHandler?(.success(text))
            self.completionHandler = nil
        }
    }
    
    deinit {
        cleanupRecording()
    }
}

// MARK: - Speech Synthesis Helper

class SpeechSynthesizer: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var completionHandler: (() -> Void)?
    
    override init() {
        super.init()
        synthesizer.delegate = self
    }
    
    func speak(_ text: String, completion: @escaping () -> Void) {
        completionHandler = completion
        
        // Configure audio session for playback BEFORE speaking
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default, options: [.duckOthers, .defaultToSpeaker])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            print("✅ Audio session configured for speech playback")
        } catch {
            print("❌ Failed to setup audio session for speech synthesis: \(error)")
        }
        
        // Stop any current speech
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        
        let utterance = AVSpeechUtterance(string: text)
        
        // Use a better voice if available
        if let voice = AVSpeechSynthesisVoice(identifier: "com.apple.voice.compact.en-US.Samantha") {
            utterance.voice = voice
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        }
        
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.pitchMultiplier = 1.0
        utterance.volume = 1.0  // Ensure volume is at max
        
        print("🔊 Starting speech synthesis...")
        synthesizer.speak(utterance)
    }
    
    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        completionHandler?()
        completionHandler = nil
        
        // Deactivate audio session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Error deactivating audio session: \(error)")
        }
    }
    
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        print("🔊 Speech synthesis started")
    }
    
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        print("✅ Speech synthesis finished")
        completionHandler?()
        completionHandler = nil
        
        // Deactivate audio session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Error deactivating audio session: \(error)")
        }
    }
    
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        print("⚠️ Speech synthesis cancelled")
        completionHandler?()
        completionHandler = nil
    }
}
