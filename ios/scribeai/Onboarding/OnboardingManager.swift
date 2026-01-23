//
//  OnboardingManager.swift
//  scribeai
//
//  Manages onboarding state and user preferences
//

import Foundation
import SwiftUI
import StoreKit

// MARK: - User Types
enum UserType: String, CaseIterable, Codable {
    case undergraduateStudent = "undergraduate_student"
    case highSchoolStudent = "high_school_student"
    case middleSchoolStudent = "middle_school_student"
    case graduateStudent = "graduate_student"
    case professional = "professional"
    case educator = "educator"
    case other = "other"

    var displayName: String {
        switch self {
        case .undergraduateStudent: return "Undergraduate Student"
        case .highSchoolStudent: return "High School Student"
        case .middleSchoolStudent: return "Middle School Student"
        case .graduateStudent: return "Graduate Student"
        case .professional: return "Professional"
        case .educator: return "Educator"
        case .other: return "Other"
        }
    }
}

// MARK: - Use Cases
enum UseCase: String, CaseIterable, Codable {
    case lectureNotes = "lecture_notes"
    case studyMaterials = "study_materials"
    case meetingNotes = "meeting_notes"
    case research = "research"
    case personalLearning = "personal_learning"
    case other = "other"

    var displayName: String {
        switch self {
        case .lectureNotes: return "Lecture Notes"
        case .studyMaterials: return "Study Materials"
        case .meetingNotes: return "Meeting Notes"
        case .research: return "Research"
        case .personalLearning: return "Personal Learning"
        case .other: return "Other"
        }
    }

    var icon: String {
        switch self {
        case .lectureNotes: return "graduationcap"
        case .studyMaterials: return "book"
        case .meetingNotes: return "person.3"
        case .research: return "magnifyingglass"
        case .personalLearning: return "brain"
        case .other: return "ellipsis.circle"
        }
    }
}

// MARK: - Onboarding Step
enum OnboardingStep: Int, CaseIterable {
    case userType = 0
    case useCase = 1
    case featureUpload = 2
    case featureNotes = 3
    case featureFlashcards = 4
    case featureQuiz = 5
    case featureAudio = 6
    case socialProof = 7
    case comparison = 8
    case trial = 9
    case notifications = 10

    var totalSteps: Int { OnboardingStep.allCases.count }

    var progress: Double {
        Double(self.rawValue + 1) / Double(totalSteps)
    }
}

// MARK: - Deletion Reasons
enum DeletionReason: String, CaseIterable, Codable {
    case notUseful = "not_useful"
    case tooExpensive = "too_expensive"
    case betterAlternative = "better_alternative"
    case privacyConcerns = "privacy_concerns"
    case technicalIssues = "technical_issues"
    case other = "other"

    var displayName: String {
        switch self {
        case .notUseful: return "Not useful for my needs"
        case .tooExpensive: return "Too expensive"
        case .betterAlternative: return "Found a better alternative"
        case .privacyConcerns: return "Privacy concerns"
        case .technicalIssues: return "Technical issues"
        case .other: return "Other"
        }
    }
}

// MARK: - Onboarding Manager
@MainActor
class OnboardingManager: ObservableObject {
    static let shared = OnboardingManager()

    // MARK: - Published Properties
    @Published var currentStep: OnboardingStep = .userType
    @Published var selectedUserType: UserType?
    @Published var selectedUseCases: Set<UseCase> = []
    @Published var hasCompletedOnboarding: Bool
    @Published var isLoading = false

    // MARK: - Keys
    private let hasCompletedOnboardingKey = "hasCompletedOnboarding"
    private let userTypeKey = "userType"
    private let useCasesKey = "useCases"
    private let preferencesSyncedKey = "preferencesSynced"

    private init() {
        self.hasCompletedOnboarding = UserDefaults.standard.bool(forKey: hasCompletedOnboardingKey)

        // Load saved preferences
        if let userTypeRaw = UserDefaults.standard.string(forKey: userTypeKey),
           let userType = UserType(rawValue: userTypeRaw) {
            self.selectedUserType = userType
        }

        if let useCasesData = UserDefaults.standard.data(forKey: useCasesKey),
           let useCases = try? JSONDecoder().decode(Set<UseCase>.self, from: useCasesData) {
            self.selectedUseCases = useCases
        }
    }

    // MARK: - Navigation
    func nextStep() {
        guard let nextStep = OnboardingStep(rawValue: currentStep.rawValue + 1) else {
            completeOnboarding()
            return
        }
        withAnimation(.easeInOut(duration: 0.3)) {
            currentStep = nextStep
        }
        trackStepCompleted()
    }

    func previousStep() {
        guard let prevStep = OnboardingStep(rawValue: currentStep.rawValue - 1) else {
            return
        }
        withAnimation(.easeInOut(duration: 0.3)) {
            currentStep = prevStep
        }
    }

    func skipOnboarding() {
        AnalyticsService.shared.track(.onboardingSkipped, properties: [
            "at_step": currentStep.rawValue,
            "step_name": String(describing: currentStep)
        ])
        completeOnboarding()
    }

    func skipTrial(timeSpentSeconds: Int = 0, selectedPlan: String? = nil) {
        AnalyticsService.shared.trackTrialScreenSkipped(
            source: "onboarding",
            timeSpentSeconds: timeSpentSeconds,
            selectedPlan: selectedPlan
        )
        // Move to notifications or complete
        if currentStep == .trial {
            nextStep()
        }
    }

    // MARK: - Completion
    func completeOnboarding() {
        hasCompletedOnboarding = true
        UserDefaults.standard.set(true, forKey: hasCompletedOnboardingKey)

        // Save preferences locally
        if let userType = selectedUserType {
            UserDefaults.standard.set(userType.rawValue, forKey: userTypeKey)
        }

        if let useCasesData = try? JSONEncoder().encode(selectedUseCases) {
            UserDefaults.standard.set(useCasesData, forKey: useCasesKey)
        }

        // Send to backend
        Task {
            await savePreferencesToBackend()
        }

        // Track completion
        AnalyticsService.shared.track(.onboardingCompleted, properties: [
            "user_type": selectedUserType?.rawValue ?? "not_selected",
            "use_cases": selectedUseCases.map { $0.rawValue }
        ])
    }

    // MARK: - Analytics
    private func trackStepCompleted() {
        var properties: [String: Any] = [
            "step": currentStep.rawValue,
            "step_name": String(describing: currentStep)
        ]

        if currentStep == .userType, let userType = selectedUserType {
            properties["selection"] = userType.rawValue
        }

        if currentStep == .useCase {
            properties["selections"] = selectedUseCases.map { $0.rawValue }
        }

        AnalyticsService.shared.track(.onboardingStepCompleted, properties: properties)
    }

    // MARK: - Backend Sync

    /// Check if preferences need to be synced to backend
    var needsSync: Bool {
        hasCompletedOnboarding && !UserDefaults.standard.bool(forKey: preferencesSyncedKey)
    }

    /// Sync preferences to backend - call this after user logs in
    func syncPreferencesToBackendIfNeeded() {
        guard needsSync else {
            print("Onboarding preferences already synced or not completed")
            return
        }

        Task {
            await savePreferencesToBackend()
        }
    }

    private func savePreferencesToBackend() async {
        guard let token = await TokenManager.shared.getValidToken() else {
            print("⚠️ No valid token, cannot sync onboarding preferences")
            return
        }

        let preferences: [String: Any] = [
            "user_type": selectedUserType?.rawValue ?? "",
            "use_cases": selectedUseCases.map { $0.rawValue }
        ]

        do {
            try await APIService.shared.saveOnboardingPreferences(token: token, preferences: preferences)
            UserDefaults.standard.set(true, forKey: preferencesSyncedKey)
            print("✅ Onboarding preferences saved to backend")
        } catch {
            print("⚠️ Failed to save onboarding preferences: \(error)")
        }
    }

    /// Get saved user type for analytics
    func getSavedUserType() -> String? {
        return UserDefaults.standard.string(forKey: userTypeKey)
    }

    /// Get saved use cases for analytics
    func getSavedUseCases() -> [String] {
        if let data = UserDefaults.standard.data(forKey: useCasesKey),
           let useCases = try? JSONDecoder().decode(Set<UseCase>.self, from: data) {
            return useCases.map { $0.rawValue }
        }
        return []
    }

    // MARK: - Reset (for testing)
    func reset() {
        currentStep = .userType
        selectedUserType = nil
        selectedUseCases = []
        hasCompletedOnboarding = false
        UserDefaults.standard.removeObject(forKey: hasCompletedOnboardingKey)
        UserDefaults.standard.removeObject(forKey: userTypeKey)
        UserDefaults.standard.removeObject(forKey: useCasesKey)
        UserDefaults.standard.removeObject(forKey: preferencesSyncedKey)
    }
}

// MARK: - Price Formatting Extension
extension StoreKitManager {
    /// Format price as per-week for better perception
    func weeklyPriceString(for product: Product) -> String? {
        let weeklyPrice: Decimal

        if product.id == SubscriptionProduct.monthly.rawValue {
            // Monthly price / 4.33 weeks
            weeklyPrice = product.price / Decimal(4.33)
        } else if product.id == SubscriptionProduct.yearly.rawValue {
            // Yearly price / 52 weeks
            weeklyPrice = product.price / Decimal(52)
        } else {
            return nil
        }

        return weeklyPrice.formatted(.currency(code: product.priceFormatStyle.currencyCode ?? "USD"))
    }
}
