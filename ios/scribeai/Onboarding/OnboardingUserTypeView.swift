//
//  OnboardingUserTypeView.swift
//  scribeai
//
//  "What describes you best?" screen
//

import SwiftUI

struct OnboardingUserTypeView: View {
    @ObservedObject private var manager = OnboardingManager.shared

    var body: some View {
        VStack(spacing: 0) {
            // Title
            VStack(spacing: 12) {
                Text("What describes you best?")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.textPrimary)
                    .multilineTextAlignment(.center)

                Text("We use this to personalize your experience :)")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 32)
            .padding(.horizontal, 24)

            // Options
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(UserType.allCases, id: \.self) { userType in
                        UserTypeButton(
                            userType: userType,
                            isSelected: manager.selectedUserType == userType
                        ) {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                manager.selectedUserType = userType
                            }
                            // Auto advance after selection
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                manager.nextStep()
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 32)
                .padding(.bottom, 100)
            }

            Spacer()
        }
    }
}

// MARK: - User Type Button
struct UserTypeButton: View {
    let userType: UserType
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(userType.displayName)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundColor(.textPrimary)

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.purple80)
                        .font(.system(size: 22))
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingUserTypeView()
    }
}
