import Foundation
import AVFoundation

#if canImport(FluidAudio)
import FluidAudio
import CoreML
#endif

/// Synthesizes a podcast script entirely on-device using Kokoro 82M via
/// FluidAudio (Apple Core ML / ANE). Two-host script segments are routed to
/// `host1Voice` or `host2Voice`; output is a single combined WAV at 24 kHz.
///
/// Eligibility is gated by `KokoroModelManager.isDeviceEligible`. Callers are
/// responsible for falling back to the cloud TTS path when ineligible or when
/// the script language is non-English.
actor KokoroPodcastSynthesizer {

    static let shared = KokoroPodcastSynthesizer()

    struct Segment: Sendable {
        let speaker: String   // "host1" | "host2"
        let text: String
    }

    struct Progress: Sendable {
        let fraction: Double
        let message: String
    }

    struct Result: Sendable {
        let fileURL: URL
        let durationSeconds: Double
    }

    private var manager: KokoroManagerHandle?

    /// Synthesize a multi-host script to a single WAV file.
    /// - Returns: file URL + duration of the generated WAV (caller owns the file).
    func synthesize(
        segments: [Segment],
        host1Voice: String,
        host2Voice: String,
        speed: Float = 1.0,
        progress: @escaping @Sendable (Progress) -> Void
    ) async throws -> Result {
        let speakable = segments.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !speakable.isEmpty else { throw KokoroError.scriptEmpty }

        try await ensureReady()
        guard let handle = manager else { throw KokoroError.modelNotReady }

        let v1 = resolveVoice(host1Voice)
        let v2 = resolveVoice(host2Voice)

        let totalChars = speakable.reduce(0) { $0 + $1.text.count }
        var processedChars = 0
        var allSamples: [Int16] = []
        let sampleRate = 24_000
        let interSegmentPauseSamples = sampleRate / 4   // 250 ms

        progress(Progress(fraction: 0, message: "Synthesizing on device…"))

        for (idx, segment) in speakable.enumerated() {
            try Task.checkCancellation()
            let voice = (segment.speaker == "host2") ? v2 : v1
            let chunks = Self.splitIntoSafeChunks(segment.text, maxChars: 70)

            for chunk in chunks {
                try Task.checkCancellation()
                let pcm = try await handle.synthesize(text: chunk, voice: voice, speed: speed)
                allSamples.append(contentsOf: pcm.samples)
                processedChars += chunk.count
                let frac = Double(processedChars) / Double(max(1, totalChars))
                progress(Progress(
                    fraction: min(0.95, frac),
                    message: "Synthesizing segment \(idx + 1) of \(speakable.count)…"
                ))
            }

            if idx < speakable.count - 1 {
                allSamples.append(contentsOf: [Int16](repeating: 0, count: interSegmentPauseSamples))
            }
        }

        let url = try writeWAV(samples: allSamples, sampleRate: sampleRate)
        let duration = Double(allSamples.count) / Double(sampleRate)
        progress(Progress(fraction: 1.0, message: "Complete"))
        return Result(fileURL: url, durationSeconds: duration)
    }

    // MARK: - Setup

    private func ensureReady() async throws {
        guard KokoroModelManager.isDeviceEligible else {
            await MainActor.run {
                KokoroModelManager.shared.markFailed("Device not eligible (needs iOS 17+ and ≥4 GB RAM)")
            }
            throw KokoroError.deviceIneligible
        }
        if manager != nil { return }

        await MainActor.run { KokoroModelManager.shared.markPreparing() }
        do {
            manager = try await KokoroManagerHandle.create()
            await MainActor.run { KokoroModelManager.shared.markReady() }
        } catch {
            await MainActor.run { KokoroModelManager.shared.markFailed(error.localizedDescription) }
            throw error
        }
    }

    private func resolveVoice(_ id: String) -> String {
        if KokoroVoiceCatalog.allIDs.contains(id) { return id }
        return KokoroVoiceCatalog.mapFromCloudVoice(id)
    }

    // MARK: - Chunking
    //
    // FluidAudio uses a 5-second short-variant Core ML graph that fits ~71
    // phoneme tokens. Pre-chunking text into ≤70-char windows keeps each call
    // inside that capacity and avoids the on-demand 15-second graph download.

    nonisolated static func splitIntoSafeChunks(_ text: String, maxChars: Int) -> [String] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if trimmed.count <= maxChars { return [trimmed] }

        var sentences: [String] = []
        var current = ""
        for ch in trimmed {
            current.append(ch)
            if ch == "." || ch == "!" || ch == "?" || ch == "\n" {
                let s = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !s.isEmpty { sentences.append(s) }
                current = ""
            }
        }
        let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { sentences.append(tail) }

        var chunks: [String] = []
        var buf = ""
        for s in sentences {
            if s.count > maxChars {
                if !buf.isEmpty { chunks.append(buf); buf = "" }
                chunks.append(contentsOf: hardSplit(s, maxChars: maxChars))
                continue
            }
            if buf.isEmpty {
                buf = s
            } else if buf.count + 1 + s.count <= maxChars {
                buf += " " + s
            } else {
                chunks.append(buf)
                buf = s
            }
        }
        if !buf.isEmpty { chunks.append(buf) }
        return chunks
    }

    nonisolated private static func hardSplit(_ s: String, maxChars: Int) -> [String] {
        var out: [String] = []
        var buf = ""
        for word in s.split(separator: " ") {
            let w = String(word)
            if w.count > maxChars {
                if !buf.isEmpty { out.append(buf); buf = "" }
                var idx = w.startIndex
                while idx < w.endIndex {
                    let next = w.index(idx, offsetBy: maxChars, limitedBy: w.endIndex) ?? w.endIndex
                    out.append(String(w[idx..<next]))
                    idx = next
                }
                continue
            }
            if buf.isEmpty {
                buf = w
            } else if buf.count + 1 + w.count <= maxChars {
                buf += " " + w
            } else {
                out.append(buf)
                buf = w
            }
        }
        if !buf.isEmpty { out.append(buf) }
        return out
    }

    // MARK: - WAV writer (16-bit PCM mono)

    private func writeWAV(samples: [Int16], sampleRate: Int) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("scribeai-podcast-\(UUID().uuidString).wav")

        var data = Data()
        let dataSize = samples.count * 2
        let chunkSize = 36 + dataSize
        data.append(contentsOf: Array("RIFF".utf8))
        data.append(contentsOf: UInt32(chunkSize).leBytes)
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8))
        data.append(contentsOf: UInt32(16).leBytes)
        data.append(contentsOf: UInt16(1).leBytes)              // PCM
        data.append(contentsOf: UInt16(1).leBytes)              // Mono
        data.append(contentsOf: UInt32(sampleRate).leBytes)
        data.append(contentsOf: UInt32(sampleRate * 2).leBytes) // byte rate
        data.append(contentsOf: UInt16(2).leBytes)              // block align
        data.append(contentsOf: UInt16(16).leBytes)             // bits per sample
        data.append(contentsOf: Array("data".utf8))
        data.append(contentsOf: UInt32(dataSize).leBytes)
        samples.withUnsafeBufferPointer { ptr in
            data.append(UnsafeBufferPointer(start: ptr.baseAddress, count: ptr.count))
        }
        try data.write(to: url)
        return url
    }
}

// MARK: - FluidAudio wrapper
//
// Isolated so the rest of the app compiles cleanly even when the FluidAudio
// SwiftPM package hasn't been resolved yet (e.g. on first checkout). Real
// inference runs only when `canImport(FluidAudio)` is true.

struct PCMResult: Sendable {
    let samples: [Int16]
    let sampleRate: Int
}

actor KokoroManagerHandle {

    #if canImport(FluidAudio)

    private let manager: KokoroTtsManager

    init(manager: KokoroTtsManager) {
        self.manager = manager
    }

    static func create() async throws -> KokoroManagerHandle {
        // iOS 26+ has a known ANE compiler regression that corrupts Kokoro's
        // output. FluidAudio's recommended workaround is to route to CPU+GPU.
        let computeUnits: MLComputeUnits
        if #available(iOS 26.0, *) {
            computeUnits = .cpuAndGPU
        } else {
            computeUnits = .all
        }

        let progressHandler: DownloadUtils.ProgressHandler = { snapshot in
            let description: String
            switch snapshot.phase {
            case .listing:
                description = "Listing model files…"
            case .downloading(let completed, let total):
                description = total > 0
                    ? "Downloading model… \(completed)/\(total) files"
                    : "Downloading model…"
            case .compiling(let modelName):
                description = modelName.isEmpty
                    ? "Compiling for Neural Engine…"
                    : "Compiling \(modelName)…"
            }
            Task { @MainActor in
                KokoroModelManager.shared.updateProgress(snapshot.fractionCompleted)
                KokoroModelManager.shared.updatePhase(description)
            }
        }
        let models = try await TtsModels.download(
            variants: [.fiveSecond],
            computeUnits: computeUnits,
            progressHandler: progressHandler
        )
        let m = KokoroTtsManager(computeUnits: computeUnits)
        try await m.initialize(models: models)
        return KokoroManagerHandle(manager: m)
    }

    func synthesize(text: String, voice: String, speed: Float) async throws -> PCMResult {
        let audioData: Data = try await manager.synthesize(
            text: text,
            voice: voice,
            voiceSpeed: speed
        )
        let samples = audioData.toInt16PCMSamples()
        return PCMResult(samples: samples, sampleRate: 24_000)
    }

    #else

    static func create() async throws -> KokoroManagerHandle {
        throw KokoroError.inferenceFailed("FluidAudio SwiftPM package not linked")
    }

    func synthesize(text: String, voice: String, speed: Float) async throws -> PCMResult {
        throw KokoroError.inferenceFailed("FluidAudio SwiftPM package not linked")
    }

    #endif
}

// MARK: - Helpers

private extension UInt32 {
    var leBytes: [UInt8] {
        withUnsafeBytes(of: self.littleEndian) { Array($0) }
    }
}

private extension UInt16 {
    var leBytes: [UInt8] {
        withUnsafeBytes(of: self.littleEndian) { Array($0) }
    }
}

#if canImport(FluidAudio)
private extension Data {
    func toInt16PCMSamples() -> [Int16] {
        var payload = self
        if payload.count > 44, payload.starts(with: Array("RIFF".utf8)) {
            payload = payload.dropFirst(44)
        }
        let count = payload.count / 2
        var samples = [Int16](repeating: 0, count: count)
        payload.withUnsafeBytes { rawBuf in
            guard let base = rawBuf.bindMemory(to: Int16.self).baseAddress else { return }
            for i in 0..<count { samples[i] = Int16(littleEndian: base[i]) }
        }
        return samples
    }
}
#endif
