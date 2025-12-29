//
//  OnboardingUseCaseView.swift
//  scribeai
//
//  "What will you use ScribeAI for?" screen - multi-select
//

import SwiftUI

struct OnboardingUseCaseView: View {
    @ObservedObject private var manager = OnboardingManager.shared

    var body: some View {
        VStack(spacing: 0) {
            // Title
            VStack(spacing: 12) {
                Text("What will you use\nScribeAI for?")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)
                    .multilineTextAlignment(.center)

                Text("Select all that apply")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 32)
            .padding(.horizontal, 24)

            // Options Grid
            ScrollView {
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ], spacing: 12) {
                    ForEach(UseCase.allCases, id: \.self) { useCase in
                        UseCaseCard(
                            useCase: useCase,
                            isSelected: manager.selectedUseCases.contains(useCase)
                        ) {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                if manager.selectedUseCases.contains(useCase) {
                                    manager.selectedUseCases.remove(useCase)
                                } else {
                                    manager.selectedUseCases.insert(useCase)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 32)
                .padding(.bottom, 120)
            }

            Spacer()

            // Continue Button
            OnboardingPrimaryButton(
                title: "Continue",
                action: { manager.nextStep() },
                isDisabled: manager.selectedUseCases.isEmpty
            )
            .padding(.bottom, 32)
        }
    }
}

// MARK: - Use Case Card
struct UseCaseCard: View {
    let useCase: UseCase
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(isSelected ? Color.purple80.opacity(0.3) : Color.purple80.opacity(0.1))
                        .frame(width: 56, height: 56)

                    Image(systemName: useCase.icon)
                        .font(.system(size: 24))
                        .foregroundColor(isSelected ? .purple80 : .textSecondary)
                }

                Text(useCase.displayName)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
            .overlay(alignment: .topTrailing) {
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.purple80)
                        .font(.system(size: 20))
                        .padding(8)
                }
            }
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingUseCaseView()
    }
}
