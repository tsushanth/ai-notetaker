//
//  OnboardingComparisonView.swift
//  scribeai
//
//  Free vs Pro comparison screen
//

import SwiftUI

struct ComparisonFeature: Identifiable {
    let id = UUID()
    let name: String
    let freeIncluded: Bool
    let proIncluded: Bool
}

struct OnboardingComparisonView: View {
    @ObservedObject private var manager = OnboardingManager.shared

    let features: [ComparisonFeature] = [
        ComparisonFeature(name: "Unlimited Notes", freeIncluded: true, proIncluded: true),
        ComparisonFeature(name: "AI Summaries", freeIncluded: true, proIncluded: true),
        ComparisonFeature(name: "Quizzes & Flashcards", freeIncluded: true, proIncluded: true),
        ComparisonFeature(name: "AI Podcasts", freeIncluded: true, proIncluded: true),
        ComparisonFeature(name: "AI Chat Assistant", freeIncluded: true, proIncluded: true),
        ComparisonFeature(name: "Priority Support", freeIncluded: false, proIncluded: true),
        ComparisonFeature(name: "Early Access Features", freeIncluded: false, proIncluded: true)
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Title
            VStack(spacing: 12) {
                Text("ScribeAI Pro users\nlearn up to 6x more\nefficiently.")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 32)
            .padding(.horizontal, 24)

            Spacer()

            // Comparison Table
            VStack(spacing: 0) {
                // Header
                HStack {
                    Spacer()
                    Text("FREE")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textSecondary)
                        .frame(width: 60)

                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.purple80.opacity(0.2))
                            .frame(width: 60, height: 28)

                        Text("PRO")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.purple80)
                    }
                    .frame(width: 60)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)

                // Features
                VStack(spacing: 0) {
                    ForEach(features) { feature in
                        ComparisonRow(feature: feature)
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.cardBackground.opacity(0.5))
                )
                .padding(.horizontal, 24)
            }

            // Beta note
            Text("All features currently free during beta!")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.accentGreen)
                .padding(.top, 16)

            Spacer()

            // Continue button
            OnboardingPrimaryButton(title: "Continue") {
                manager.nextStep()
            }
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Comparison Row
struct ComparisonRow: View {
    let feature: ComparisonFeature

    var body: some View {
        HStack {
            Text(feature.name)
                .font(.system(size: 15))
                .foregroundColor(.textPrimary)

            Spacer()

            // Free column
            Group {
                if feature.freeIncluded {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.accentGreen)
                } else {
                    Text("—")
                        .font(.system(size: 14))
                        .foregroundColor(.textTertiary)
                }
            }
            .frame(width: 60)

            // Pro column
            ZStack {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.purple80.opacity(0.1))
                    .frame(width: 60, height: 32)

                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.purple80)
            }
            .frame(width: 60)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.05))
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingComparisonView()
    }
}
