//
//  ProcessingStepsView.swift
//  scribeai
//
//  Reusable processing steps UI component
//

import SwiftUI

// MARK: - Processing Step Types

/// YouTube processing steps
enum ScribeYouTubeStep: Int, CaseIterable {
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
enum ScribeRecordingStep: Int, CaseIterable {
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
enum ScribeDocumentStep: Int, CaseIterable {
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
enum ScribeScanStep: Int, CaseIterable {
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

struct ScribeProcessingStep: Identifiable {
    let id = UUID()
    let title: String
    var status: ScribeStepStatus
    
    enum ScribeStepStatus {
        case pending
        case inProgress
        case completed
    }
}

// MARK: - Processing State

enum ScribeProcessingState {
    case idle
    case processing(steps: [ScribeProcessingStep], currentIndex: Int, uploadComplete: Bool)
    case success(noteId: String?)
    case error(message: String)
}

// MARK: - Processing Steps View

struct ScribeProcessingStepsView: View {
    let steps: [ScribeProcessingStep]
    let currentIndex: Int
    let uploadComplete: Bool
    var onNotifyMe: (() -> Void)? = nil  // Make optional with default nil
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 24)
                
                // Steps
                VStack(spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        ScribeProcessingStepRow(
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
                
                // Only show notification card if callback is provided
                if let onNotifyMe = onNotifyMe {
                    NotificationCard(onNotifyMe: onNotifyMe)
                        .padding(.horizontal, 24)
                }
                
                Spacer()
            }
        }
    }
}

// MARK: - Processing Step Row

struct ScribeProcessingStepRow: View {
    let step: ScribeProcessingStep
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

struct ScribeNotificationCard: View {
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
            .buttonStyle(PlainButtonStyle())
        }
        .padding(20)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }
}

// MARK: - Success View

struct ScribeSuccessView: View {
    let onViewNote: () -> Void
    let onGoHome: () -> Void
    
    @State private var isViewNotePressed = false
    @State private var isGoHomePressed = false
    
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
            
            // Buttons - Fixed with proper button styles and contentShape
            VStack(spacing: 16) {
                Button {
                    print("📱 View Note button tapped")
                    onViewNote()
                } label: {
                    HStack {
                        Image(systemName: "eye.fill")
                        Text("View Note")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(isViewNotePressed ? Color.purple80.opacity(0.8) : Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .buttonStyle(PlainButtonStyle())
                .contentShape(Rectangle())
                .simultaneousGesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in isViewNotePressed = true }
                        .onEnded { _ in isViewNotePressed = false }
                )
                
                Button {
                    print("📱 Go Home button tapped")
                    onGoHome()
                } label: {
                    Text("Go to Home")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PlainButtonStyle())
                .contentShape(Rectangle())
            }
            .padding(.horizontal, 24)
            
            Spacer()
                .frame(height: 32)
        }
        .background(Color.darkBackground)
        .contentShape(Rectangle())
    }
}

// MARK: - Error View

struct ScribeErrorView: View {
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
            
            // Buttons - Fixed with proper button styles
            VStack(spacing: 16) {
                Button {
                    print("📱 Retry button tapped")
                    onRetry()
                } label: {
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
                .buttonStyle(PlainButtonStyle())
                .contentShape(Rectangle())
                
                Button {
                    print("📱 Go Back button tapped")
                    onGoBack()
                } label: {
                    Text("Go Back")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .buttonStyle(PlainButtonStyle())
                .contentShape(Rectangle())
            }
            .padding(.horizontal, 24)
            
            Spacer()
                .frame(height: 32)
        }
        .background(Color.darkBackground)
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        Color.darkBackground
            .ignoresSafeArea()
        
        ScribeProcessingStepsView(
            steps: [
                ScribeProcessingStep(title: "Uploading audio", status: .completed),
                ScribeProcessingStep(title: "Transcribing audio", status: .completed),
                ScribeProcessingStep(title: "Identifying speakers", status: .completed),
                ScribeProcessingStep(title: "Analyzing content", status: .inProgress),
                ScribeProcessingStep(title: "Summarizing key points", status: .pending),
                ScribeProcessingStep(title: "Finalizing your note", status: .pending)
            ],
            currentIndex: 3,
            uploadComplete: true,
            onNotifyMe: {}
        )
    }
}

#Preview("Success View") {
    ScribeSuccessView(
        onViewNote: { print("View Note") },
        onGoHome: { print("Go Home") }
    )
}
