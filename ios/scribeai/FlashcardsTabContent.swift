//
//  FlashcardsTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//


import SwiftUI

struct FlashcardsTabContent: View {
    let note: Note
    @State private var flashcardSet: FlashcardSet?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var currentCardIndex = 0
    @State private var isFlipped = false
    @State private var dragOffset: CGSize = .zero
    @State private var showPaywall = false
    @State private var totalFlips = 0
    @State private var selectedCardCount: Int = 20
    @State private var specialInstructions: String = ""
    @FocusState private var isInstructionsFocused: Bool

    private let cardCountOptions: [(count: Int, label: String, description: String)] = [
        (10, "10", "Quick review"),
        (20, "20", "Standard set"),
        (30, "30", "Comprehensive"),
        (50, "50", "Deep dive")
    ]
    
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
                    
                    Text("Generating flashcards...")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                    
                    Text("Creating cards from your notes")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
                .frame(maxHeight: .infinity)
            } else if let flashcardSet = flashcardSet, !flashcardSet.cards.isEmpty {
                // Flashcards UI with preview gate
                ZStack {
                    VStack(spacing: 0) {
                        // Header with count and regenerate button
                        HStack {
                            HStack(spacing: 8) {
                                Text("Card \(currentCardIndex + 1) of \(flashcardSet.cards.count)")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.textSecondary)

                                // Show preview badge if in preview mode
                                PreviewBadge()
                            }

                            Spacer()

                            Button(action: {
                                // Reset and generate new flashcards
                                self.flashcardSet = nil
                                self.currentCardIndex = 0
                                self.isFlipped = false
                                generateFlashcards()
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

                        // Progress bar
                        VStack(spacing: 8) {

                            GeometryReader { geometry in
                                ZStack(alignment: .leading) {
                                    Rectangle()
                                        .fill(Color.darkSurfaceVariant)
                                        .frame(height: 4)

                                    Rectangle()
                                        .fill(Color.purple80)
                                        .frame(width: geometry.size.width * CGFloat(currentCardIndex + 1) / CGFloat(flashcardSet.cards.count), height: 4)
                                }
                            }
                            .frame(height: 4)
                        }
                        .padding()

                        Spacer()

                        // Flashcard
                        FlashcardView(
                            card: flashcardSet.cards[currentCardIndex],
                            isFlipped: $isFlipped,
                            dragOffset: $dragOffset,
                            onFlip: { trackFlip() }
                        )
                        .padding(.horizontal, 24)

                        Spacer()

                        // Navigation Buttons
                        HStack(spacing: 16) {
                            Button(action: previousCard) {
                                Image(systemName: "chevron.left.circle.fill")
                                    .font(.system(size: 40))
                                    .foregroundColor(currentCardIndex > 0 ? .purple80 : .textTertiary)
                            }
                            .disabled(currentCardIndex == 0)

                            Spacer()

                            Button(action: { isFlipped.toggle() }) {
                                HStack {
                                    Image(systemName: "arrow.2.squarepath")
                                    Text("Flip Card")
                                        .font(.system(size: 16, weight: .medium))
                                }
                                .padding(.horizontal, 24)
                                .padding(.vertical, 12)
                                .background(Color.purple80)
                                .foregroundColor(.white)
                                .cornerRadius(20)
                            }

                            Spacer()

                            Button(action: nextCard) {
                                Image(systemName: "chevron.right.circle.fill")
                                    .font(.system(size: 40))
                                    .foregroundColor(currentCardIndex < flashcardSet.cards.count - 1 ? .purple80 : .textTertiary)
                            }
                            .disabled(currentCardIndex >= flashcardSet.cards.count - 1)
                        }
                        .padding(.horizontal, 32)
                        .padding(.bottom, 32)
                    }

                    // Preview gate overlay - shows after free limit reached
                    FlashcardPreviewOverlay(
                        currentIndex: currentCardIndex,
                        totalCards: flashcardSet.cards.count,
                        freeLimit: FeaturePreviewGateManager.shared.freeFlashcardsCount,
                        onSubscribe: {
                            AnalyticsService.shared.trackPaywallViewed(source: "flashcard_preview_gate")
                            showPaywall = true
                        }
                    )
                }
            } else {
                // Generate Flashcards UI with inline options
                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 12) {
                            Image(systemName: "rectangle.stack.fill")
                                .font(.system(size: 60))
                                .foregroundColor(.purple80)

                            Text("Generate AI Flashcards")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundColor(.textPrimary)

                            Text("Create flashcards for effective studying")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 20)

                        // Number of Cards Section
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                Image(systemName: "square.stack.3d.up")
                                    .font(.system(size: 14))
                                    .foregroundColor(.textSecondary)
                                Text("Number of Cards")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundColor(.textPrimary)
                            }

                            // 2x2 Grid for card count options
                            LazyVGrid(columns: [
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12)
                            ], spacing: 12) {
                                ForEach(cardCountOptions, id: \.count) { option in
                                    CardCountOptionButton(
                                        count: option.count,
                                        label: option.label,
                                        description: option.description,
                                        isSelected: selectedCardCount == option.count,
                                        isRecommended: option.count == 20
                                    ) {
                                        selectedCardCount = option.count
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 20)

                        // Special Instructions Section
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                HStack(spacing: 8) {
                                    Image(systemName: "square.and.pencil")
                                        .font(.system(size: 14))
                                        .foregroundColor(.textSecondary)
                                    Text("Special Instructions")
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundColor(.textPrimary)
                                }

                                Spacer()

                                Text("OPTIONAL")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundColor(.textTertiary)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.darkSurfaceVariant)
                                    .cornerRadius(4)
                            }

                            TextField("Describe your flashcard focus...", text: $specialInstructions, axis: .vertical)
                                .font(.system(size: 15))
                                .foregroundColor(.textPrimary)
                                .lineLimit(2...4)
                                .padding(14)
                                .background(Color.cardBackground)
                                .cornerRadius(12)
                                .focused($isInstructionsFocused)
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
                            isInstructionsFocused = false
                            let instructions = specialInstructions.trimmingCharacters(in: .whitespacesAndNewlines)
                            generateFlashcards(count: selectedCardCount, instructions: instructions.isEmpty ? nil : instructions)
                        }) {
                            HStack {
                                Image(systemName: "sparkles")
                                Text("Generate \(selectedCardCount) Flashcards")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.purple80)
                            .foregroundColor(.white)
                            .cornerRadius(28)
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .onAppear {
            AnalyticsService.shared.trackFlashcardsTabViewed(noteId: note.id)
            loadFlashcards()
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                PaywallView(source: "flashcards_feature_gate") {
                    showPaywall = false
                    Task {
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                }
            }
        }
    }

    private func loadFlashcards() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("❌ No auth token found")
            return
        }
        
        print("🗂️ Loading flashcards for note: \(note.id)")
        
        Task {
            do {
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "flashcards")
                await MainActor.run {
                    if let flashcards = aiContent?.flashcards {
                        print("✅ Flashcards loaded: \(flashcards.count) cards")
                        // Create FlashcardSet from AIContent
                        self.flashcardSet = FlashcardSet(
                            id: aiContent?.id ?? UUID().uuidString,
                            noteId: note.id,
                            cards: flashcards,
                            createdAt: aiContent?.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                    } else {
                        print("ℹ️ No flashcards found")
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    print("❌ Error loading flashcards: \(error)")
                }
            }
        }
    }

    private func generateFlashcards(count: Int = 20, instructions: String? = nil) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }

        AnalyticsService.shared.trackFlashcardsGenerateStarted(noteId: note.id)
        isGenerating = true
        errorMessage = nil

        Task {
            do {
                let aiContent = try await APIService.shared.generateFlashcards(
                    token: token,
                    noteId: note.id,
                    contentLength: note.content.count,
                    count: count,
                    instructions: instructions
                )
                await MainActor.run {
                    if let flashcards = aiContent.flashcards {
                        self.flashcardSet = FlashcardSet(
                            id: aiContent.id ?? UUID().uuidString,
                            noteId: note.id,
                            cards: flashcards,
                            createdAt: aiContent.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                    }
                    self.isGenerating = false
                }
            } catch let error as APIError {
                await MainActor.run {
                    self.isGenerating = false
                    switch error {
                    case .subscriptionRequired, .freeTierLimitReached:
                        print("🔐 Subscription required for flashcards")
                        self.showPaywall = true
                    default:
                        self.errorMessage = error.localizedDescription
                    }
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isGenerating = false
                }
            }
        }
    }

    private func nextCard() {
        guard let flashcardSet = flashcardSet,
              currentCardIndex < flashcardSet.cards.count - 1 else {
            // Track completion when reaching the last card
            if let flashcardSet = flashcardSet, currentCardIndex >= flashcardSet.cards.count - 1 {
                AnalyticsService.shared.trackFlashcardsCompleted(
                    totalCards: flashcardSet.cards.count,
                    totalFlips: totalFlips
                )
            }
            return
        }

        AnalyticsService.shared.trackFlashcardSwiped(cardIndex: currentCardIndex, direction: "next")
        withAnimation {
            currentCardIndex += 1
            isFlipped = false
        }
    }

    private func previousCard() {
        guard currentCardIndex > 0 else { return }

        AnalyticsService.shared.trackFlashcardSwiped(cardIndex: currentCardIndex, direction: "previous")
        withAnimation {
            currentCardIndex -= 1
            isFlipped = false
        }
    }

    private func trackFlip() {
        guard let flashcardSet = flashcardSet else { return }
        totalFlips += 1
        AnalyticsService.shared.trackFlashcardFlipped(
            cardIndex: currentCardIndex,
            totalCards: flashcardSet.cards.count
        )
    }
}

struct FlashcardView: View {
    let card: Flashcard
    @Binding var isFlipped: Bool
    @Binding var dragOffset: CGSize
    var onFlip: (() -> Void)?

    var body: some View {
        ZStack {
            // Back of card
            CardSide(text: card.back, color: Color.purple80)
                .opacity(isFlipped ? 1 : 0)
                .rotation3DEffect(
                    .degrees(isFlipped ? 0 : 180),
                    axis: (x: 0, y: 1, z: 0)
                )

            // Front of card
            CardSide(text: card.front, color: Color.cardBackground)
                .opacity(isFlipped ? 0 : 1)
                .rotation3DEffect(
                    .degrees(isFlipped ? 180 : 0),
                    axis: (x: 0, y: 1, z: 0)
                )
        }
        .frame(height: 400)
        .rotation3DEffect(
            .degrees(dragOffset.width / 10),
            axis: (x: 0, y: 1, z: 0)
        )
        .offset(dragOffset)
        .gesture(
            DragGesture()
                .onChanged { value in
                    dragOffset = value.translation
                }
                .onEnded { value in
                    if abs(value.translation.width) > 100 {
                        withAnimation {
                            isFlipped.toggle()
                            onFlip?()
                        }
                    }
                    withAnimation {
                        dragOffset = .zero
                    }
                }
        )
        .onTapGesture {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                isFlipped.toggle()
                onFlip?()
            }
        }
    }
}

struct CardSide: View {
    let text: String
    let color: Color

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(color)
                .shadow(color: Color.black.opacity(0.2), radius: 10, x: 0, y: 5)

            VStack {
                Spacer()

                Text(text)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(color == .cardBackground ? .textPrimary : .white)
                    .multilineTextAlignment(.center)
                    .padding(32)

                Spacer()

                Image(systemName: "arrow.2.squarepath")
                    .font(.system(size: 16))
                    .foregroundColor((color == .cardBackground ? Color.textPrimary : Color.white).opacity(0.5))
                    .padding(.bottom, 20)
            }
        }
    }
}


struct CardCountOptionButton: View {
    let count: Int
    let label: String
    let description: String
    let isSelected: Bool
    let isRecommended: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                HStack {
                    Spacer()
                    if isRecommended && isSelected {
                        Image(systemName: "sparkles")
                            .font(.system(size: 12))
                            .foregroundColor(.purple80)
                    }
                }
                .frame(height: 16)

                Text(label)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(isSelected ? .purple80 : .textPrimary)

                Text(description)
                    .font(.system(size: 12))
                    .foregroundColor(isSelected ? .purple80 : .textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(isSelected ? Color.purple80.opacity(0.15) : Color.darkSurfaceVariant)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}
