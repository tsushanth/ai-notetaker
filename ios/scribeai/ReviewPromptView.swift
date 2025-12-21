//
//  ReviewPromptView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 12/8/25.
//

import SwiftUI

struct ReviewPromptView: View {
    @ObservedObject var reviewHelper = StoreReviewHelper.shared
    
    var body: some View {
        ZStack {
            // Dimmed background
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture {
                    reviewHelper.userDismissed()
                }
            
            // Prompt card
            VStack(spacing: 24) {
                // Icon
                ZStack {
                    Circle()
                        .fill(Color.purple80.opacity(0.2))
                        .frame(width: 80, height: 80)
                    
                    Image(systemName: "sparkles")
                        .font(.system(size: 36))
                        .foregroundColor(.purple80)
                }
                
                // Title
                Text("Enjoying Scribe AI?")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.textPrimary)
                
                // Subtitle
                Text("Is Scribe AI helping you study faster and learn better?")
                    .font(.system(size: 15))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                
                // Buttons
                VStack(spacing: 12) {
                    // Positive
                    Button(action: {
                        reviewHelper.userRespondedPositive()
                    }) {
                        HStack {
                            Image(systemName: "heart.fill")
                            Text("Yes, I love it!")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.purple80)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    
                    // Negative
                    Button(action: {
                        reviewHelper.userRespondedNegative()
                    }) {
                        Text("Not yet")
                            .font(.system(size: 16))
                            .foregroundColor(.textSecondary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                    }
                }
            }
            .padding(24)
            .background(Color.cardBackground)
            .cornerRadius(20)
            .shadow(color: .black.opacity(0.3), radius: 20, x: 0, y: 10)
            .padding(.horizontal, 32)
        }
    }
}

// MARK: - View Modifier for easy integration

struct ReviewPromptModifier: ViewModifier {
    @ObservedObject var reviewHelper = StoreReviewHelper.shared
    
    func body(content: Content) -> some View {
        ZStack {
            content
            
            if reviewHelper.showSoftPrompt {
                ReviewPromptView()
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    .animation(.spring(response: 0.3), value: reviewHelper.showSoftPrompt)
            }
        }
    }
}

extension View {
    func reviewPrompt() -> some View {
        modifier(ReviewPromptModifier())
    }
}
