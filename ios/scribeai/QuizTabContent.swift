//
//  QuizTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import SwiftUI

struct QuizTabContent: View {
    let note: Note
    @State private var quiz: Quiz?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var currentQuestionIndex = 0
    @State private var selectedAnswer: Int?
    @State private var showExplanation = false
    @State private var score = 0
    @State private var answeredQuestions: Set<String> = []
    @State private var showPaywall = false
    @State private var subscriptionError: APIError?
    
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
                    
                    Text("Generating quiz...")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                    
                    Text("Creating questions from your notes")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
                .frame(maxHeight: .infinity)
            } else if let quiz = quiz {
                // Quiz UI
                if currentQuestionIndex < quiz.questions.count {
                    VStack(spacing: 0) {
                        // Header with question count and generate more button
                        HStack {
                            Text("\(quiz.questions.count) Questions")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.textSecondary)

                            Spacer()

                            Button(action: {
                                // Reset and generate new quiz
                                self.quiz = nil
                                self.currentQuestionIndex = 0
                                self.selectedAnswer = nil
                                self.showExplanation = false
                                self.score = 0
                                self.answeredQuestions.removeAll()
                                generateQuiz()
                            }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "sparkles")
                                        .font(.system(size: 12))
                                    Text("Generate More")
                                        .font(.system(size: 14, weight: .medium))
                                }
                                .foregroundColor(.purple80)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)

                        QuizQuestionView(
                            question: quiz.questions[currentQuestionIndex],
                            questionNumber: currentQuestionIndex + 1,
                            totalQuestions: quiz.questions.count,
                            selectedAnswer: $selectedAnswer,
                            showExplanation: $showExplanation,
                            onNext: {
                                handleNext()
                            }
                        )
                    }
                } else {
                    // Quiz Complete
                    QuizResultsView(
                        score: score,
                        total: quiz.questions.count,
                        onRestart: {
                            resetQuiz()
                        },
                        onGenerateNew: {
                            // Reset and generate new quiz
                            self.quiz = nil
                            self.currentQuestionIndex = 0
                            self.selectedAnswer = nil
                            self.showExplanation = false
                            self.score = 0
                            self.answeredQuestions.removeAll()
                            generateQuiz()
                        }
                    )
                }
            } else {
                // Generate Quiz UI
                VStack(spacing: 24) {
                    Spacer()
                    
                    Image(systemName: "questionmark.circle.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.purple80)
                    
                    Text("Generate Quiz")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.textPrimary)
                    
                    Text("Test your knowledge with AI-generated questions")
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
                        generateQuiz()
                    }) {
                        HStack {
                            Image(systemName: "sparkles")
                            Text("Generate Quiz")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.purple80)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 32)
                    
                    Spacer()
                }
            }
        }
        .onAppear {
            AnalyticsService.shared.trackQuizTabViewed(noteId: note.id)
            loadQuiz()
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                ScribeRemotePaywallView(triggerSource: "quiz_feature_gate") {
                    showPaywall = false
                    // Refresh access status after purchase
                    Task {
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                }
            }
        }
    }

    private func loadQuiz() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("❌ No auth token found")
            isLoading = false
            return
        }
        
        print("📝 Loading quiz for note: \(note.id)")
        
        Task {
            do {
                // Get quiz content specifically
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "quiz")
                
                await MainActor.run {
                    if let quizQuestions = aiContent?.questions?.quizQuestions {
                        print("✅ Quiz loaded with \(quizQuestions.count) questions")
                        // Create Quiz object from AIContent
                        self.quiz = Quiz(
                            id: aiContent?.id ?? UUID().uuidString,
                            noteId: note.id,
                            questions: quizQuestions,
                            createdAt: aiContent?.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                    } else {
                        print("ℹ️ No quiz found")
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    print("❌ Error loading quiz: \(error)")
                    self.errorMessage = "Failed to load quiz: \(error.localizedDescription)"
                }
            }
        }
    }

    private func generateQuiz() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }

        AnalyticsService.shared.trackQuizGenerateStarted(noteId: note.id)
        isGenerating = true
        errorMessage = nil

        Task {
            do {
                let aiContent = try await APIService.shared.generateQuiz(token: token, noteId: note.id, contentLength: note.content.count)
                
                await MainActor.run {
                    print("📦 Generated quiz data: \(aiContent)")
                    
                    // Extract questions from the wrapper
                    if let quizQuestions = aiContent.questions?.quizQuestions, !quizQuestions.isEmpty {
                        print("✅ Quiz generated with \(quizQuestions.count) questions")
                        self.quiz = Quiz(
                            id: aiContent.id ?? UUID().uuidString,
                            noteId: note.id,
                            questions: quizQuestions,
                            createdAt: aiContent.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                    } else {
                        print("❌ No questions in generated quiz")
                        self.errorMessage = "Failed to generate quiz questions"
                    }
                    self.isGenerating = false
                }
            } catch let error as APIError {
                await MainActor.run {
                    self.isGenerating = false
                    switch error {
                    case .subscriptionRequired, .freeTierLimitReached:
                        print("🔐 Subscription required for quiz")
                        self.subscriptionError = error
                        self.showPaywall = true
                    default:
                        print("❌ Error generating quiz: \(error)")
                        self.errorMessage = "Failed to generate quiz: \(error.localizedDescription)"
                    }
                }
            } catch {
                await MainActor.run {
                    print("❌ Error generating quiz: \(error)")
                    self.errorMessage = "Failed to generate quiz: \(error.localizedDescription)"
                    self.isGenerating = false
                }
            }
        }
    }
    
    private func handleNext() {
        if let selectedAnswer = selectedAnswer {
            let question = quiz!.questions[currentQuestionIndex]
            let isCorrect = selectedAnswer == question.correctAnswer
            if isCorrect {
                score += 1
            }
            answeredQuestions.insert(question.id)

            // Track question answered
            AnalyticsService.shared.trackQuizQuestionAnswered(
                questionIndex: currentQuestionIndex,
                isCorrect: isCorrect,
                totalQuestions: quiz!.questions.count
            )
        }

        // Move to next question
        currentQuestionIndex += 1
        selectedAnswer = nil
        showExplanation = false

        // Track quiz completion when all questions answered
        if let quiz = quiz, currentQuestionIndex >= quiz.questions.count {
            let percentage = quiz.questions.count > 0 ? (score * 100 / quiz.questions.count) : 0
            AnalyticsService.shared.trackQuizCompleted(
                score: score,
                total: quiz.questions.count,
                percentageCorrect: percentage
            )
        }
    }

    private func resetQuiz() {
        AnalyticsService.shared.trackQuizRestarted()
        currentQuestionIndex = 0
        selectedAnswer = nil
        showExplanation = false
        score = 0
        answeredQuestions.removeAll()
    }
}

struct QuizQuestionView: View {
    let question: QuizQuestion
    let questionNumber: Int
    let totalQuestions: Int
    @Binding var selectedAnswer: Int?
    @Binding var showExplanation: Bool
    let onNext: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            // Progress
            VStack(alignment: .leading, spacing: 8) {
                Text("Question \(questionNumber) of \(totalQuestions)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textSecondary)
                
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Rectangle()
                            .fill(Color.darkSurfaceVariant)
                            .frame(height: 4)
                        
                        Rectangle()
                            .fill(Color.purple80)
                            .frame(width: geometry.size.width * CGFloat(questionNumber) / CGFloat(totalQuestions), height: 4)
                    }
                }
                .frame(height: 4)
            }
            .padding()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Question
                    Text(question.question)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.textPrimary)
                        .padding()
                    
                    // Options
                    VStack(spacing: 12) {
                        ForEach(0..<question.options.count, id: \.self) { index in
                            OptionButton(
                                text: question.options[index],
                                index: index,
                                isSelected: selectedAnswer == index,
                                isCorrect: showExplanation ? index == question.correctAnswer : nil
                            ) {
                                if !showExplanation {
                                    selectedAnswer = index
                                }
                            }
                        }
                    }
                    .padding(.horizontal)
                    
                    // Explanation
                    if showExplanation, let explanation = question.explanation {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Image(systemName: "lightbulb.fill")
                                    .foregroundColor(.purple80)
                                Text("Explanation")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.textPrimary)
                            }
                            
                            Text(explanation)
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .lineSpacing(4)
                        }
                        .padding()
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }
                    
                    Spacer(minLength: 100)
                }
            }
            
            // Action Button
            VStack {
                if !showExplanation && selectedAnswer != nil {
                    Button(action: {
                        showExplanation = true
                    }) {
                        Text("Check Answer")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.purple80)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal)
                    .padding(.bottom)
                } else if showExplanation {
                    Button(action: onNext) {
                        HStack {
                            Text(questionNumber < totalQuestions ? "Next Question" : "View Results")
                                .font(.system(size: 16, weight: .semibold))
                            Image(systemName: "arrow.right")
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.purple80)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal)
                    .padding(.bottom)
                }
            }
        }
    }
}

struct OptionButton: View {
    let text: String
    let index: Int
    let isSelected: Bool
    let isCorrect: Bool?
    let action: () -> Void
    
    private var backgroundColor: Color {
        if let isCorrect = isCorrect {
            if isCorrect {
                return Color.green.opacity(0.2)
            } else if isSelected {
                return Color.accentRed.opacity(0.2)
            }
        } else if isSelected {
            return Color.purple80.opacity(0.2)
        }
        return Color.cardBackground
    }
    
    private var borderColor: Color {
        if let isCorrect = isCorrect {
            return isCorrect ? .green : (isSelected ? .accentRed : .darkSurfaceVariant)
        }
        return isSelected ? .purple80 : .darkSurfaceVariant
    }
    
    private var icon: String? {
        if let isCorrect = isCorrect {
            return isCorrect ? "checkmark.circle.fill" : (isSelected ? "xmark.circle.fill" : nil)
        }
        return nil
    }
    
    var body: some View {
        Button(action: action) {
            HStack {
                Text(optionLabel(index))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(Color.darkSurfaceVariant)
                    .cornerRadius(8)
                
                Text(text)
                    .font(.system(size: 15))
                    .foregroundColor(.textPrimary)
                    .multilineTextAlignment(.leading)
                
                Spacer()
                
                if let icon = icon {
                    Image(systemName: icon)
                        .foregroundColor(isCorrect == true ? .green : .accentRed)
                }
            }
            .padding()
            .background(backgroundColor)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(borderColor, lineWidth: 2)
            )
        }
        .disabled(isCorrect != nil)
    }
    
    private func optionLabel(_ index: Int) -> String {
        ["A", "B", "C", "D"][index]
    }
}

struct QuizResultsView: View {
    let score: Int
    let total: Int
    let onRestart: () -> Void
    var onGenerateNew: (() -> Void)? = nil

    private var percentage: Int {
        Int((Double(score) / Double(total)) * 100)
    }

    private var message: String {
        switch percentage {
        case 90...100: return "Outstanding! 🎉"
        case 70..<90: return "Great job! 👏"
        case 50..<70: return "Good effort! 💪"
        default: return "Keep practicing! 📚"
        }
    }

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 16) {
                Text(message)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)

                ZStack {
                    Circle()
                        .stroke(Color.darkSurfaceVariant, lineWidth: 12)
                        .frame(width: 150, height: 150)

                    Circle()
                        .trim(from: 0, to: CGFloat(percentage) / 100)
                        .stroke(Color.purple80, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                        .frame(width: 150, height: 150)
                        .rotationEffect(.degrees(-90))

                    Text("\(percentage)%")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundColor(.textPrimary)
                }

                Text("\(score) out of \(total) correct")
                    .font(.system(size: 18))
                    .foregroundColor(.textSecondary)
            }

            Spacer()

            VStack(spacing: 16) {
                // Restart same quiz
                Button(action: onRestart) {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                        Text("Restart Quiz")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }

                // Generate new quiz
                if let onGenerateNew = onGenerateNew {
                    Button(action: onGenerateNew) {
                        HStack {
                            Image(systemName: "sparkles")
                            Text("Generate New Quiz")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.clear)
                        .foregroundColor(.purple80)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.purple80, lineWidth: 2)
                        )
                    }
                }
            }
            .padding(.horizontal, 32)
            .padding(.bottom)
        }
    }
}
