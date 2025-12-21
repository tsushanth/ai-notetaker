//
//  YouTubeProcessingStep.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/27/25.
//


//
//  ProcessingStepsView.swift
//  scribeai
//
//  Reusable processing steps UI component
//

import SwiftUI

// MARK: - Processing Step Types

/// YouTube processing steps
enum YouTubeProcessingStep: Int, CaseIterable {
    case uploading = 0
    case fetchingTranscript = 1
    case analyzingContent = 2
    case summarizingKeyPoints = 3
    case finalizingNote = 4
    
    var title: String {
        switch self {
        case .uploading: return "Sending video URL"
        case .fetchingTranscript: return "Fetching transcript"
        case .analyzingContent: return "Analyzing content"
        case .summarizingKeyPoints: return "Summarizing key points"
        case .finalizingNote: return "Finalizing your note"
        }
    }
}

/// Audio recording processing steps
enum RecordingProcessingStep: Int, CaseIterable {
    case uploadingAudio = 0
    case transcribingAudio = 1
    case identifyingSpeakers = 2
    case analyzingContent = 3
    case summarizingKeyPoints = 4
    case finalizingNote = 5
    
    var title: String {
        switch self {
        case .uploadingAudio: return "Uploading audio"
        case .transcribingAudio: return "Transcribing audio"
        case .identifyingSpeakers: return "Identifying speakers"
        case .analyzingContent: return "Analyzing content"
        case .summarizingKeyPoints: return "Summarizing key points"
        case .finalizingNote: return "Finalizing your note"
        }
    }
}

/// PDF/Document processing steps
enum DocumentProcessingStep: Int, CaseIterable {
    case uploadingDocument = 0
    case extractingText = 1
    case analyzingContent = 2
    case summarizingKeyPoints = 3
    case finalizingNote = 4
    
    var title: String {
        switch self {
        case .uploadingDocument: return "Uploading document"
        case .extractingText: return "Extracting text"
        case .analyzingContent: return "Analyzing content"
        case .summarizingKeyPoints: return "Summarizing key points"
        case .finalizingNote: return "Finalizing your note"
        }
    }
}

/// Scan processing steps
enum ScanProcessingStep: Int, CaseIterable {
    case uploadingImages = 0
    case performingOCR = 1
    case analyzingContent = 2
    case summarizingKeyPoints = 3
    case finalizingNote = 4
    
    var title: String {
        switch self {
        case .uploadingImages: return "Uploading scanned images"
        case .performingOCR: return "Extracting text (OCR)"
        case .analyzingContent: return "Analyzing content"
        case .summarizingKeyPoints: return "Summarizing key points"
        case .finalizingNote: return "Finalizing your note"
        }
    }
}

// MARK: - Generic Processing Step

struct ProcessingStep: Identifiable {
    let id = UUID()
    let title: String
    var status: StepStatus
    
    enum StepStatus {
        case pending
        case inProgress
        case completed
    }
}

// MARK: - Processing State

enum ProcessingState {
    case idle
    case processing(steps: [ProcessingStep], currentIndex: Int, uploadComplete: Bool)
    case success(noteId: String?)
    case error(message: String)
}

// MARK: - Processing Steps View

struct ProcessingStepsView: View {
    let steps: [ProcessingStep]
    let currentIndex: Int
    let uploadComplete: Bool
    let onNotifyMe: () -> Void
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 24)
                
                // Steps
                VStack(spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        ProcessingStepRow(
                            step: step,
                            isLast: index == steps.count - 1
                        )
                    }
                }
                .padding(.horizontal, 24)
                
                Spacer()
                    .frame(height: 40)
                
                // Upload complete message
                if uploadComplete {
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.icloud.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.green)
                        
                        Text("Upload is complete. It's safe to leave now.")
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.cardBackground)
                    .cornerRadius(12)
                    .padding(.horizontal, 24)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
                
                Spacer()
                    .frame(height: 24)
                
                // Notification card
                NotificationCard(onNotifyMe: onNotifyMe)
                    .padding(.horizontal, 24)
                
                Spacer()
            }
        }
    }
}

// MARK: - Processing Step Row

struct ProcessingStepRow: View {
    let step: ProcessingStep
    let isLast: Bool
    
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // Step indicator
            VStack(spacing: 0) {
                // Circle
                ZStack {
                    Circle()
                        .fill(circleBackground)
                        .frame(width: 32, height: 32)
                    
                    if step.status == .completed {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                    } else if step.status == .inProgress {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                            .scaleEffect(0.7)
                    }
                    
                    if step.status == .pending {
                        Circle()
                            .stroke(Color.darkSurfaceVariant, lineWidth: 2)
                            .frame(width: 32, height: 32)
                    }
                }
                
                // Connecting line
                if !isLast {
                    Rectangle()
                        .fill(step.status == .completed ? Color.purple80 : Color.darkSurfaceVariant)
                        .frame(width: 2, height: 32)
                }
            }
            
            // Step title
            Text(step.title)
                .font(.system(size: 16, weight: step.status == .inProgress ? .medium : .regular))
                .foregroundColor(textColor)
                .padding(.top, 4)
            
            Spacer()
        }
    }
    
    private var circleBackground: Color {
        switch step.status {
        case .completed: return .purple80
        case .inProgress: return .clear
        case .pending: return .clear
        }
    }
    
    private var textColor: Color {
        switch step.status {
        case .completed, .inProgress: return .textPrimary
        case .pending: return .textTertiary
        }
    }
}

// MARK: - Notification Card

struct NotificationCard: View {
    let onNotifyMe: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "bell.fill")
                .font(.system(size: 24))
                .foregroundColor(.textSecondary)
            
            Text("Get notified when your notes are ready")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.textPrimary)
            
            Text("Notes usually take a few minutes to generate. We'll let you know when they're ready.")
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
                .lineSpacing(4)
            
            Button(action: onNotifyMe) {
                Text("Notify me")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Color.darkSurface)
                    .cornerRadius(8)
            }
        }
        .padding(20)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }
}

// MARK: - Success View

struct ProcessingSuccessView: View {
    let onViewNote: () -> Void
    let onGoHome: () -> Void
    
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // Success icon
            ZStack {
                Circle()
                    .fill(Color.green.opacity(0.2))
                    .frame(width: 100, height: 100)
                
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(.green)
            }
            
            Text("Your note is ready!")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(.textPrimary)
            
            Text("We've processed your content and created study materials.")
                .font(.system(size: 16))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            
            Spacer()
            
            // Buttons
            VStack(spacing: 12) {
                Button(action: onViewNote) {
                    HStack {
                        Image(systemName: "eye.fill")
                        Text("View Note")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                
                Button(action: onGoHome) {
                    Text("Go to Home")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                }
            }
            .padding(.horizontal, 24)
            
            Spacer()
                .frame(height: 32)
        }
    }
}

// MARK: - Error View

struct ProcessingErrorView: View {
    let message: String
    let onRetry: () -> Void
    let onGoBack: () -> Void
    
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 64))
                .foregroundColor(.accentRed)
            
            Text("Something went wrong")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(.textPrimary)
            
            Text(message)
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            
            Spacer()
            
            // Buttons
            VStack(spacing: 12) {
                Button(action: onRetry) {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                        Text("Try Again")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                
                Button(action: onGoBack) {
                    Text("Go Back")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                }
            }
            .padding(.horizontal, 24)
            
            Spacer()
                .frame(height: 32)
        }
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        Color.darkBackground
            .ignoresSafeArea()
        
        ProcessingStepsView(
            steps: [
                ProcessingStep(title: "Uploading audio", status: .completed),
                ProcessingStep(title: "Transcribing audio", status: .completed),
                ProcessingStep(title: "Identifying speakers", status: .completed),
                ProcessingStep(title: "Analyzing content", status: .inProgress),
                ProcessingStep(title: "Summarizing key points", status: .pending),
                ProcessingStep(title: "Finalizing your note", status: .pending)
            ],
            currentIndex: 3,
            uploadComplete: true,
            onNotifyMe: {}
        )
    }
}