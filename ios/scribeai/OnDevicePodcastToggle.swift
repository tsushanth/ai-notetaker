import SwiftUI

/// Inline toggle for on-device Kokoro synthesis vs cloud TTS. Surfaces in the
/// podcast generation panel only on eligible devices (iOS 17+, A12+, ≥4 GB RAM).
/// Default: ON. Persists via UserDefaults at `scribeai.kokoro.onDeviceEnabled`.
struct OnDevicePodcastToggle: View {

    @State private var enabled: Bool = KokoroModelManager.isOnDeviceEnabledByUser
    @ObservedObject private var manager = KokoroModelManager.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: $enabled) {
                HStack(spacing: 8) {
                    Image(systemName: "iphone.gen3")
                        .font(.system(size: 14))
                        .foregroundColor(.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("On-device synthesis")
                            .font(.system(size: 15, weight: .medium))
                        Text(statusText)
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                }
            }
            .onChange(of: enabled) { _, newValue in
                KokoroModelManager.isOnDeviceEnabledByUser = newValue
            }

            if case .preparing = manager.state {
                ProgressView(value: manager.downloadProgress)
                    .progressViewStyle(.linear)
            }
        }
        .padding(.vertical, 4)
    }

    private var statusText: String {
        if !enabled {
            return "Using cloud voices"
        }
        switch manager.state {
        case .ready:
            return "Ready · runs free + offline"
        case .preparing:
            if !manager.phaseDescription.isEmpty {
                return manager.phaseDescription
            }
            let pct = Int((manager.downloadProgress * 100).rounded())
            return "Downloading model… \(pct)%"
        case .failed(let message):
            return "Failed: \(message)"
        case .notReady:
            return "Downloads ~250 MB on first podcast"
        }
    }
}
