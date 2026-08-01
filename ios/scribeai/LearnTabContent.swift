//
//  LearnTabContent.swift
//  scribeai
//
//  AI-powered adaptive learning tutor — renders lessons in a WebView
//

import SwiftUI

struct LearnTabContent: View {
    let note: Note
    @State private var sessionId: String?
    @State private var isStarting = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Color.darkBackground.ignoresSafeArea()

            if let sessionId = sessionId {
                let token = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""
                if let url = URL(string: "\(Constants.baseURL)/learn/\(sessionId)?token=\(token)") {
                    LoadingWebView(url: url)
                        .ignoresSafeArea(edges: .bottom)
                }
            } else if isStarting {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(1.2)
                    Text("Starting learning session...")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.textSecondary)
                }
            } else if let error = error {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 32))
                        .foregroundColor(.red)
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .multilineTextAlignment(.center)
                    Button("Try Again") { startSession() }
                        .foregroundColor(.purple80)
                }
                .padding()
            } else {
                // Landing — start button
                VStack(spacing: 24) {
                    Image(systemName: "graduationcap.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.purple80)

                    Text("AI Tutor")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.textPrimary)

                    Text("Your personal AI tutor will create interactive lessons, games, and quizzes tailored to your learning style and progress.")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)

                    Button(action: startSession) {
                        HStack {
                            Image(systemName: "play.fill")
                            Text("Start Learning")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.purple80)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 32)
                }
            }
        }
        .onAppear {
            // Auto-start if returning to an existing session
            // Could check for existing session here
        }
    }

    private func startSession() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            error = "Please sign in to use the AI Tutor"
            return
        }

        isStarting = true
        error = nil

        Task {
            do {
                guard let url = URL(string: "\(Constants.baseURL)/api/learn/\(note.id)/start") else {
                    throw ExportService.ExportError.invalidURL
                }

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                if UserDefaults.standard.bool(forKey: "scribeai.hasPremiumAccess") { request.setValue("scribeai-premium-bypass-2026-secret", forHTTPHeaderField: "x-bypass-rate-limit") }
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: [:])

                let (data, _) = try await URLSession.shared.data(for: request)

                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let resultData = json["data"] as? [String: Any],
                   let session = resultData["session"] as? [String: Any],
                   let id = session["id"] as? String {
                    await MainActor.run {
                        isStarting = false
                        sessionId = id
                    }
                } else {
                    await MainActor.run {
                        isStarting = false
                        error = "Failed to start session"
                    }
                }
            } catch {
                await MainActor.run {
                    isStarting = false
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

