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
                // Flashcards UI
                VStack(spacing: 0) {
                    // Header with count and regenerate button
                    HStack {
                        Text("Card \(currentCardIndex + 1) of \(flashcardSet.cards.count)")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.textSecondary)

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
                        dragOffset: $dragOffset
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
            } else {
                // Generate Flashcards UI
                VStack(spacing: 24) {
                    Spacer()
                    
                    Image(systemName: "rectangle.stack.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.purple80)
                    
                    Text("Generate Flashcards")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.textPrimary)
                    
                    Text("Create flashcards for effective studying")
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
                        generateFlashcards()
                    }) {
                        HStack {
                            Image(systemName: "sparkles")
                            Text("Generate Flashcards")
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
            loadFlashcards()
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

    private func generateFlashcards() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }
        
        isGenerating = true
        errorMessage = nil
        
        Task {
            do {
                let aiContent = try await APIService.shared.generateFlashcards(token: token, noteId: note.id, contentLength: note.content.count)
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
            return
        }
        
        withAnimation {
            currentCardIndex += 1
            isFlipped = false
        }
    }
    
    private func previousCard() {
        guard currentCardIndex > 0 else { return }
        
        withAnimation {
            currentCardIndex -= 1
            isFlipped = false
        }
    }
}

struct FlashcardView: View {
    let card: Flashcard
    @Binding var isFlipped: Bool
    @Binding var dragOffset: CGSize
    
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
                    .foregroundColor((color == .cardBackground ? Color.textPrimary : Color.white).opacity(0.5))  // ✅ Fixed
                    .padding(.bottom, 20)
            }
        }
    }
}
