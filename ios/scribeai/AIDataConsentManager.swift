import Foundation

// MARK: - AI Data Consent Manager

/// Manages user consent for sharing data with third-party AI services.
@MainActor
final class AIDataConsentManager: ObservableObject {

    // MARK: - Singleton

    static let shared = AIDataConsentManager()

    // MARK: - Published State

    @Published private(set) var hasConsented: Bool
    @Published private(set) var consentDate: Date?
    @Published private(set) var consentVersion: Int

    // Increment when new services are added to re-prompt users
    static let currentConsentVersion = 1

    // MARK: - Keys

    private enum Keys {
        static let granted = "ai_data_consent_granted"
        static let date = "ai_data_consent_date"
        static let version = "ai_data_consent_version"
    }

    // MARK: - Initialization

    private init() {
        self.hasConsented = UserDefaults.standard.bool(forKey: Keys.granted)
        self.consentDate = UserDefaults.standard.object(forKey: Keys.date) as? Date
        self.consentVersion = UserDefaults.standard.integer(forKey: Keys.version)
    }

    // MARK: - Computed

    /// True if user has never consented or consented to an older version.
    var needsConsent: Bool {
        !hasConsented || consentVersion < Self.currentConsentVersion
    }

    // MARK: - Actions

    func grantConsent() {
        hasConsented = true
        consentDate = Date()
        consentVersion = Self.currentConsentVersion
        UserDefaults.standard.set(true, forKey: Keys.granted)
        UserDefaults.standard.set(Date(), forKey: Keys.date)
        UserDefaults.standard.set(Self.currentConsentVersion, forKey: Keys.version)
    }

    func revokeConsent() {
        hasConsented = false
        consentDate = nil
        consentVersion = 0
        UserDefaults.standard.set(false, forKey: Keys.granted)
        UserDefaults.standard.removeObject(forKey: Keys.date)
        UserDefaults.standard.set(0, forKey: Keys.version)
    }
}
