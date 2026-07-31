import Foundation
import UIKit

private let kokoroOnDeviceToggleKey = "scribeai.kokoro.onDeviceEnabled"

/// Surfaces the on-device Kokoro 82M TTS model state to the UI.
///
/// FluidAudio (Apple Core ML) owns the actual download/cache/load. This class
/// is the read-only view a Settings or onboarding screen can bind to.
@MainActor
final class KokoroModelManager: ObservableObject {

    static let shared = KokoroModelManager()

    enum State: Equatable {
        case notReady
        case preparing
        case ready
        case failed(message: String)
    }

    @Published private(set) var state: State = .notReady
    @Published private(set) var lastError: String? = nil
    @Published private(set) var downloadProgress: Double = 0
    /// Rich phase string from FluidAudio (e.g. "Downloading model… 12/33 files",
    /// "Compiling kokoro_21_5s…"). Empty until the first progress callback fires.
    @Published private(set) var phaseDescription: String = ""

    /// FluidAudio's Kokoro 82M Core ML bundle is ~250 MB across ~38 files.
    static let estimatedDownloadBytes: Int64 = 250 * 1_024 * 1_024

    /// Matches ReadAloud's gate: iOS 17+, A12+ (implied by RAM check), ≥4 GB RAM.
    /// Allows slack to 3.7 GB so iPhone 11/SE3-class devices (4 GB) qualify.
    nonisolated static var isDeviceEligible: Bool {
        let totalRAM = ProcessInfo.processInfo.physicalMemory
        guard totalRAM >= 3_700_000_000 else { return false }
        if #available(iOS 17.0, *) { return true }
        return false
    }

    func markReady() {
        state = .ready
        lastError = nil
        downloadProgress = 1
    }

    func markPreparing() {
        state = .preparing
        downloadProgress = 0
        phaseDescription = "Preparing voice model…"
    }

    func updateProgress(_ fraction: Double) {
        downloadProgress = max(downloadProgress, min(1, fraction))
    }

    func updatePhase(_ description: String) {
        phaseDescription = description
    }

    func markFailed(_ message: String) {
        state = .failed(message: message)
        lastError = message
    }

    func reset() {
        state = .notReady
        lastError = nil
        downloadProgress = 0
    }

    var isReady: Bool {
        if case .ready = state { return true }
        return false
    }

    private init() {}

    // MARK: - User toggle (persisted)
    //
    // Defaults to ON: most users on eligible devices benefit from offline +
    // free synthesis. Users can opt out from Voice Settings if they prefer
    // the cloud voices.

    nonisolated static var isOnDeviceEnabledByUser: Bool {
        get {
            if UserDefaults.standard.object(forKey: kokoroOnDeviceToggleKey) == nil { return true }
            return UserDefaults.standard.bool(forKey: kokoroOnDeviceToggleKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: kokoroOnDeviceToggleKey)
        }
    }
}

enum KokoroError: LocalizedError {
    case deviceIneligible
    case modelNotReady
    case inferenceFailed(String)
    case scriptEmpty

    var errorDescription: String? {
        switch self {
        case .deviceIneligible:
            return "On-device synthesis requires iOS 17+ and at least 4 GB of memory."
        case .modelNotReady:
            return "On-device model has not finished downloading yet."
        case .inferenceFailed(let detail):
            return "On-device synthesis failed: \(detail)"
        case .scriptEmpty:
            return "Script has no spoken segments."
        }
    }
}

enum KokoroVoiceCatalog {
    struct Entry {
        let id: String
        let displayName: String
        let language: String
        let isFemale: Bool
    }

    static let entries: [Entry] = [
        .init(id: "af_bella",   displayName: "Bella (US)",   language: "en-US", isFemale: true),
        .init(id: "am_michael", displayName: "Michael (US)", language: "en-US", isFemale: false),
        .init(id: "bf_emma",    displayName: "Emma (UK)",    language: "en-GB", isFemale: true),
        .init(id: "bm_george",  displayName: "George (UK)",  language: "en-GB", isFemale: false),
    ]

    static let allIDs: Set<String> = Set(entries.map(\.id))

    static func entry(for id: String) -> Entry? {
        entries.first { $0.id == id }
    }

    /// Map an OpenAI/ElevenLabs voice slot to the closest Kokoro voice.
    /// Picks based on perceived gender of the source voice; defaults to US.
    /// Unknown IDs route to `af_bella` (the warmest female default).
    static func mapFromCloudVoice(_ id: String) -> String {
        let lower = id.lowercased()
        // OpenAI: alloy, echo, fable, onyx (male), nova (female), shimmer (female)
        // Common ElevenLabs male names: adam, antoni, arnold, sam, josh, callum, charlie
        let maleHints: Set<String> = [
            "onyx", "echo", "fable", "ash", "verse",
            "adam", "antoni", "arnold", "sam", "josh", "callum", "charlie",
            "george", "michael", "daniel", "ethan", "liam", "noah",
        ]
        let britishHints: Set<String> = [
            "fable", "callum", "charlie", "george", "emma", "british", "uk",
        ]
        let isMale = maleHints.contains { lower.contains($0) }
        let isBritish = britishHints.contains { lower.contains($0) }
        switch (isBritish, isMale) {
        case (true, true):   return "bm_george"
        case (true, false):  return "bf_emma"
        case (false, true):  return "am_michael"
        case (false, false): return "af_bella"
        }
    }
}
