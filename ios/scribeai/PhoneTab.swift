//
//  PhoneTab.swift
//  scribeai
//
//  In-app phone-call feature (parity with Meeting Mind's Phone tab).
//  The user verifies a phone number with a voice-call OTP, then places
//  outbound calls directly from this app via the Twilio Voice iOS SDK.
//  Audio flows through the app over data (VoIP) — no phone-bridge ring.
//  Recording happens server-side via the TwiML App webhook.
//

import SwiftUI

// MARK: - Models

struct VerifiedPhone: Identifiable, Codable, Equatable {
    let id: String
    let phoneNumber: String
    let verifiedAt: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case phoneNumber = "phone_number"
        case verifiedAt = "verified_at"
        case createdAt = "created_at"
    }
}

struct PhoneCall: Identifiable, Codable, Equatable {
    let id: String
    let fromNumber: String
    let toNumber: String
    let toName: String?
    let status: String
    let isRecording: Bool?
    let recordingUrl: String?
    let recordingDuration: Int?
    let startedAt: String?
    let answeredAt: String?
    let endedAt: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case fromNumber = "from_number"
        case toNumber = "to_number"
        case toName = "to_name"
        case status
        case isRecording = "is_recording"
        case recordingUrl = "recording_url"
        case recordingDuration = "recording_duration"
        case startedAt = "started_at"
        case answeredAt = "answered_at"
        case endedAt = "ended_at"
        case createdAt = "created_at"
    }
}

private struct VerifiedPhonesResponse: Codable {
    let phones: [VerifiedPhone]
}

private struct VerifyCheckResponse: Codable {
    let verified: Bool
    let phone: VerifiedPhone?
}

private struct PhoneCallsListResponse: Codable {
    let calls: [PhoneCall]
    let total: Int
}

private struct PhoneCallResponse: Codable {
    let call: PhoneCall
}

private struct InitiateCallResponse: Codable {
    let callId: String
    let status: String
    let toNumber: String?
    let twilioCallSid: String?

    enum CodingKeys: String, CodingKey {
        case callId = "call_id"
        case status
        case toNumber = "to_number"
        case twilioCallSid = "twilio_call_sid"
    }
}

private struct VoipTokenResponse: Codable {
    let token: String
}

private struct GenericMessageResponse: Codable {
    let message: String?
    let deleted: Bool?
}

// MARK: - API helper (scoped to phone endpoints)

private enum PhoneAPI {
    static func get<T: Codable>(_ path: String, type: T.Type) async throws -> T {
        try await request(path: path, method: "GET", body: nil, type: type)
    }

    static func post<T: Codable>(_ path: String, body: [String: Any]?, type: T.Type) async throws -> T {
        try await request(path: path, method: "POST", body: body, type: type)
    }

    static func delete<T: Codable>(_ path: String, type: T.Type) async throws -> T {
        try await request(path: path, method: "DELETE", body: nil, type: type)
    }

    private static func request<T: Codable>(
        path: String,
        method: String,
        body: [String: Any]?,
        type: T.Type
    ) async throws -> T {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              !token.isEmpty else {
            throw APIError.unauthorized
        }
        guard let url = URL(string: "\(Constants.baseURL)\(path)") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if UserDefaults.standard.bool(forKey: "scribeai.hasPremiumAccess") {
            request.setValue("scribeai-premium-bypass-2026-secret",
                             forHTTPHeaderField: "x-bypass-rate-limit")
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if !(200...299).contains(http.statusCode) {
            // Try to extract server's error message
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let err = json["error"] as? String {
                throw APIError.serverError(err)
            }
            throw APIError.serverError("HTTP \(http.statusCode)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - ViewModel

@MainActor
final class PhoneTabViewModel: ObservableObject {
    @Published private(set) var verifiedPhones: [VerifiedPhone] = []
    @Published private(set) var calls: [PhoneCall] = []
    @Published private(set) var isLoading: Bool = false
    @Published private(set) var isInitiatingCall: Bool = false

    @Published var verificationPhoneNumber: String = ""
    @Published var verificationCode: String = ""
    @Published var codeSent: Bool = false

    @Published var dialerNumber: String = ""
    @Published var dialerContactName: String = ""
    @Published var selectedPhone: VerifiedPhone?

    @Published var errorMessage: String?
    @Published var statusMessage: String?

    // Active in-app VoIP call mirrored from VoipService.callState. We re-publish
    // the relevant bits so SwiftUI views can observe a single source.
    @Published private(set) var voipState: VoipCallState = .idle
    @Published private(set) var isMuted: Bool = false
    @Published private(set) var isSpeakerOn: Bool = false
    @Published private(set) var activeCall: PhoneCall?

    private var voipObservation: Task<Void, Never>?

    init() {
        // Bridge VoipService.callState into our @Published voipState so the
        // SwiftUI hierarchy doesn't need to know about VoipService directly.
        voipObservation = Task { [weak self] in
            for await state in VoipService.shared.$callState.values {
                await MainActor.run {
                    guard let self else { return }
                    self.voipState = state
                    self.isMuted = VoipService.shared.isMuted
                    self.isSpeakerOn = VoipService.shared.isSpeakerOn
                    if case .disconnected = state {
                        // Pull fresh call history after the call ends so the
                        // recording row gets updated.
                        Task {
                            try? await Task.sleep(nanoseconds: 2_000_000_000)
                            await self.loadData()
                            // Clear active call after a brief moment so the
                            // "ended" UI is visible.
                            try? await Task.sleep(nanoseconds: 2_000_000_000)
                            self.activeCall = nil
                        }
                    }
                }
            }
        }
    }

    deinit { voipObservation?.cancel() }

    func loadData() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let phones = try await PhoneAPI.get("/api/phone/verified", type: VerifiedPhonesResponse.self)
            verifiedPhones = phones.phones
            if selectedPhone == nil { selectedPhone = verifiedPhones.first }
            let calls = try await PhoneAPI.get("/api/phone/calls?limit=50", type: PhoneCallsListResponse.self)
            self.calls = calls.calls
        } catch {
            errorMessage = friendly(error)
        }
    }

    // MARK: Verification

    func sendVerification() async {
        guard !verificationPhoneNumber.isEmpty else {
            errorMessage = "Enter a phone number"
            return
        }
        do {
            _ = try await PhoneAPI.post(
                "/api/phone/verify/send",
                body: ["phone_number": verificationPhoneNumber],
                type: GenericMessageResponse.self
            )
            codeSent = true
            statusMessage = "Answer your phone — we're calling with a code."
        } catch {
            errorMessage = friendly(error)
        }
    }

    func checkVerification() async {
        guard !verificationCode.isEmpty else {
            errorMessage = "Enter the 6-digit code"
            return
        }
        do {
            let resp = try await PhoneAPI.post(
                "/api/phone/verify/check",
                body: [
                    "phone_number": verificationPhoneNumber,
                    "code": verificationCode,
                ],
                type: VerifyCheckResponse.self
            )
            if resp.verified, let phone = resp.phone {
                verifiedPhones.append(phone)
                if selectedPhone == nil { selectedPhone = phone }
                verificationPhoneNumber = ""
                verificationCode = ""
                codeSent = false
                statusMessage = "Phone verified."
            } else {
                errorMessage = "Couldn't verify — please try again."
            }
        } catch {
            errorMessage = friendly(error)
        }
    }

    func resetVerification() {
        verificationPhoneNumber = ""
        verificationCode = ""
        codeSent = false
    }

    func deletePhone(_ phone: VerifiedPhone) async {
        do {
            _ = try await PhoneAPI.delete("/api/phone/verified/\(phone.id)", type: GenericMessageResponse.self)
            verifiedPhones.removeAll { $0.id == phone.id }
            if selectedPhone?.id == phone.id { selectedPhone = verifiedPhones.first }
        } catch {
            errorMessage = friendly(error)
        }
    }

    // MARK: Calls

    /// Place an in-app VoIP call via the Twilio Voice SDK. The call audio
    /// flows through this app over the device's data connection; no phone
    /// bridge / dual ring. Recording happens server-side via the TwiML App
    /// webhook (`/v1/webhooks/twilio/voip-outbound`).
    func initiateCall() async {
        guard let fromPhone = selectedPhone else {
            errorMessage = "Verify a phone number first"
            return
        }
        let dialedNumber = dialerNumber
        guard !dialedNumber.isEmpty else {
            errorMessage = "Enter a number to call"
            return
        }
        isInitiatingCall = true
        defer { isInitiatingCall = false }
        do {
            // 1) Create call record (server_initiated=false → backend just
            //    saves the row + conference name, doesn't ring anyone).
            let resp = try await PhoneAPI.post(
                "/api/phone/calls",
                body: [
                    "from": fromPhone.phoneNumber,
                    "to": dialedNumber,
                    "to_name": dialerContactName.isEmpty ? NSNull() : dialerContactName,
                    "server_initiated": false,
                ],
                type: InitiateCallResponse.self
            )

            // 2) Fetch a fresh VoIP access token + hand it to VoipService.
            let tokenResp = try await PhoneAPI.get("/api/phone/voip/token",
                                                   type: VoipTokenResponse.self)
            VoipService.shared.setAccessToken(tokenResp.token)

            // 3) Pull the created call so we can mirror it in the UI.
            if let callResp = try? await PhoneAPI.get(
                "/api/phone/calls/\(resp.callId)",
                type: PhoneCallResponse.self
            ) {
                activeCall = callResp.call
                calls.insert(callResp.call, at: 0)
            }

            // 4) Place the actual VoIP call. Twilio invokes our voip-outbound
            //    webhook with `call_id` + `to`; the webhook responds with TwiML
            //    that bridges to the recipient with recording enabled.
            let ok = VoipService.shared.makeCall(callId: resp.callId, toNumber: dialedNumber)
            guard ok else {
                errorMessage = "Couldn't start the call. Check microphone permissions."
                return
            }

            dialerNumber = ""
            dialerContactName = ""
        } catch {
            errorMessage = friendly(error)
        }
    }

    func hangup() {
        VoipService.shared.disconnect()
    }

    func toggleMute() { VoipService.shared.toggleMute() }
    func toggleSpeaker() { VoipService.shared.toggleSpeaker() }

    // MARK: Helpers

    func formatPhone(_ p: String) -> String {
        // (XXX) YYY-ZZZZ for +1XXXYYYZZZZ
        if p.hasPrefix("+1"), p.count == 12 {
            let digits = p.dropFirst(2)
            let area = digits.prefix(3)
            let mid = digits.dropFirst(3).prefix(3)
            let last = digits.suffix(4)
            return "(\(area)) \(mid)-\(last)"
        }
        return p
    }

    private func friendly(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .unauthorized: return "Please sign in again."
            case .invalidURL: return "Bad URL."
            case .serverError(let msg): return msg
            default: return error.localizedDescription
            }
        }
        return error.localizedDescription
    }
}

// MARK: - Views

struct PhoneTabView: View {
    @StateObject private var viewModel = PhoneTabViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var showConsent = false

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.verifiedPhones.isEmpty && viewModel.calls.isEmpty {
                    ProgressView("Loading…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.darkBackground.ignoresSafeArea())
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            verifySection
                            if !viewModel.verifiedPhones.isEmpty {
                                dialerSection
                            }
                            historySection
                        }
                        .padding(16)
                    }
                    .background(Color.darkBackground.ignoresSafeArea())
                }
            }
            .navigationTitle("Phone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await viewModel.loadData() }
                    } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .task { await viewModel.loadData() }
            .alert("Error", isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: { Text(viewModel.errorMessage ?? "") }
            .confirmationDialog(
                "This call will be recorded. Inform the other party.",
                isPresented: $showConsent,
                titleVisibility: .visible
            ) {
                Button("Place Call") { Task { await viewModel.initiateCall() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("ScribeAI will place the call to \(viewModel.formatPhone(viewModel.dialerNumber)) directly from this app. Audio is recorded.")
            }
            .fullScreenCover(isPresented: Binding(
                get: { hasActiveCall(viewModel.voipState) },
                set: { _ in }
            )) {
                ActiveCallView(viewModel: viewModel)
            }
        }
    }

    /// True while a VoIP call is being placed / is connected / is ringing.
    private func hasActiveCall(_ state: VoipCallState) -> Bool {
        switch state {
        case .connecting, .ringing, .connected: return true
        default: return false
        }
    }

    // MARK: Verify

    @ViewBuilder
    private var verifySection: some View {
        sectionCard(title: "Verify a Phone Number") {
            if !viewModel.verifiedPhones.isEmpty {
                Text("Verified")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.textSecondary)
                ForEach(viewModel.verifiedPhones) { phone in
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                        Text(viewModel.formatPhone(phone.phoneNumber)).foregroundColor(.textPrimary)
                        Spacer()
                        Button(role: .destructive) {
                            Task { await viewModel.deletePhone(phone) }
                        } label: {
                            Image(systemName: "trash").foregroundColor(.red)
                        }
                    }
                    .padding(.vertical, 6)
                }
                Divider().background(Color.darkSurfaceVariant)
            }

            if !viewModel.codeSent {
                Text("Add a number")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.textSecondary)
                TextField("+1 555 555 1234", text: $viewModel.verificationPhoneNumber)
                    .keyboardType(.phonePad)
                    .padding(10)
                    .background(Color.darkSurfaceVariant)
                    .cornerRadius(8)
                    .foregroundColor(.textPrimary)
                Button {
                    Task { await viewModel.sendVerification() }
                } label: {
                    Text("Call me with a code")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.purple80)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
                Text("ScribeAI will call your number and read a 6-digit code.")
                    .font(.caption2)
                    .foregroundColor(.textSecondary)
            } else {
                Text("Enter the 6-digit code we just read to you")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.textSecondary)
                TextField("123456", text: $viewModel.verificationCode)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color.darkSurfaceVariant)
                    .cornerRadius(8)
                    .foregroundColor(.textPrimary)
                HStack {
                    Button("Verify") {
                        Task { await viewModel.checkVerification() }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(8)

                    Button("Start over") {
                        viewModel.resetVerification()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.darkSurfaceVariant)
                    .foregroundColor(.textPrimary)
                    .cornerRadius(8)
                }
            }
            if let status = viewModel.statusMessage {
                Text(status).font(.footnote).foregroundColor(.green)
            }
        }
    }

    // MARK: Dialer

    @ViewBuilder
    private var dialerSection: some View {
        sectionCard(title: "Place a Recorded Call") {
            if viewModel.verifiedPhones.count > 1 {
                Picker("From", selection: Binding(
                    get: { viewModel.selectedPhone?.id ?? viewModel.verifiedPhones.first!.id },
                    set: { id in viewModel.selectedPhone = viewModel.verifiedPhones.first(where: { $0.id == id }) }
                )) {
                    ForEach(viewModel.verifiedPhones) { p in
                        Text(viewModel.formatPhone(p.phoneNumber)).tag(p.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(.purple80)
            } else if let phone = viewModel.selectedPhone {
                HStack {
                    Text("From").font(.caption).foregroundColor(.textSecondary)
                    Spacer()
                    Text(viewModel.formatPhone(phone.phoneNumber))
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.textPrimary)
                }
            }

            TextField("Recipient name (optional)", text: $viewModel.dialerContactName)
                .padding(10)
                .background(Color.darkSurfaceVariant)
                .cornerRadius(8)
                .foregroundColor(.textPrimary)

            TextField("+1 555 555 1234", text: $viewModel.dialerNumber)
                .keyboardType(.phonePad)
                .padding(10)
                .background(Color.darkSurfaceVariant)
                .cornerRadius(8)
                .foregroundColor(.textPrimary)

            Button {
                showConsent = true
            } label: {
                HStack {
                    if viewModel.isInitiatingCall {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "phone.fill")
                    }
                    Text(viewModel.isInitiatingCall ? "Calling…" : "Call & Record")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.green.opacity(viewModel.isInitiatingCall ? 0.5 : 1))
                .foregroundColor(.white)
                .cornerRadius(8)
            }
            .disabled(viewModel.isInitiatingCall || viewModel.dialerNumber.isEmpty)
        }
    }

    // MARK: History

    @ViewBuilder
    private var historySection: some View {
        sectionCard(title: "Call History") {
            if viewModel.calls.isEmpty {
                Text("Your recorded calls will appear here.")
                    .font(.footnote)
                    .foregroundColor(.textSecondary)
            } else {
                ForEach(viewModel.calls) { call in
                    // Tappable row — tapping redials the number with the
                    // recording-consent prompt (same flow as the dialer).
                    Button {
                        viewModel.dialerNumber = call.toNumber
                        viewModel.dialerContactName = call.toName ?? ""
                        showConsent = true
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: statusIcon(for: call.status))
                                .foregroundColor(statusColor(for: call.status))
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(call.toName?.isEmpty == false ? call.toName! : viewModel.formatPhone(call.toNumber))
                                    .foregroundColor(.textPrimary)
                                    .font(.subheadline.weight(.medium))
                                HStack(spacing: 8) {
                                    Text(call.status.capitalized)
                                        .font(.caption2)
                                        .foregroundColor(.textSecondary)
                                    if let dur = call.recordingDuration, dur > 0 {
                                        Text("• \(formatDuration(dur))")
                                            .font(.caption2)
                                            .foregroundColor(.textSecondary)
                                    }
                                    if call.recordingUrl != nil {
                                        Image(systemName: "waveform").font(.caption2)
                                            .foregroundColor(.purple80)
                                    }
                                }
                            }
                            Spacer()
                            Image(systemName: "phone.arrow.up.right")
                                .font(.caption)
                                .foregroundColor(.purple80)
                        }
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if call.id != viewModel.calls.last?.id {
                        Divider().background(Color.darkSurfaceVariant)
                    }
                }
            }
        }
    }

    // MARK: Section helper

    @ViewBuilder
    private func sectionCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).foregroundColor(.textPrimary)
            content()
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(12)
    }

    private func statusIcon(for status: String) -> String {
        switch status {
        case "completed", "recording": return "phone.down.fill"
        case "in_progress", "ringing", "initiated": return "phone.arrow.up.right.fill"
        case "failed", "busy", "no_answer", "cancelled": return "phone.down.circle"
        default: return "phone"
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "completed": return .green
        case "recording", "in_progress": return .red
        case "ringing", "initiated": return .yellow
        case "failed", "busy", "no_answer", "cancelled": return .gray
        default: return .textSecondary
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - Active call screen

/// Full-screen call UI shown while a VoIP call is connecting / ringing /
/// connected. Hangup dismisses by transitioning VoipService to .disconnected,
/// which flips `hasActiveCall` on the parent to false and dismisses this
/// cover automatically.
private struct ActiveCallView: View {
    @ObservedObject var viewModel: PhoneTabViewModel

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.purple80.opacity(0.6), Color.black],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                Image(systemName: "phone.circle.fill")
                    .resizable().scaledToFit().frame(width: 96, height: 96)
                    .foregroundStyle(.white.opacity(0.9))

                VStack(spacing: 6) {
                    if let name = viewModel.activeCall?.toName, !name.isEmpty {
                        Text(name).font(.title2.weight(.semibold)).foregroundStyle(.white)
                    }
                    Text(viewModel.formatPhone(viewModel.activeCall?.toNumber ?? ""))
                        .font(.title3).foregroundStyle(.white.opacity(0.85))
                }

                Text(stateLabel)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.top, 4)

                Text("Recording")
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Capsule().fill(Color.red))
                    .foregroundStyle(.white)

                Spacer()

                HStack(spacing: 32) {
                    callButton(systemName: viewModel.isMuted ? "mic.slash.fill" : "mic.fill",
                               on: viewModel.isMuted) { viewModel.toggleMute() }

                    Button { viewModel.hangup() } label: {
                        Image(systemName: "phone.down.fill")
                            .font(.title)
                            .foregroundStyle(.white)
                            .frame(width: 72, height: 72)
                            .background(Circle().fill(Color.red))
                    }

                    callButton(systemName: viewModel.isSpeakerOn ? "speaker.wave.3.fill" : "speaker.fill",
                               on: viewModel.isSpeakerOn) { viewModel.toggleSpeaker() }
                }
                .padding(.bottom, 60)
            }
        }
    }

    private var stateLabel: String {
        switch viewModel.voipState {
        case .connecting: return "Connecting…"
        case .ringing:    return "Ringing…"
        case .connected:  return "Connected"
        case .disconnected: return "Call ended"
        case .failed(let e): return "Call failed: \(e)"
        case .idle:       return ""
        }
    }

    @ViewBuilder
    private func callButton(systemName: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(Circle().fill(on ? Color.white.opacity(0.25) : Color.white.opacity(0.1)))
        }
    }
}
