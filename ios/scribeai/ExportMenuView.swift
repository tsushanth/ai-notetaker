//
//  ExportMenuView.swift
//  scribeai
//
//  Export & Share bottom sheet with paywall gating for premium exports
//

import SwiftUI

struct ExportMenuView: View {
    let note: Note
    @Environment(\.dismiss) var dismiss
    @ObservedObject private var gateManager = SubscriptionGateManager.shared

    @State private var isExporting = false
    @State private var exportError: String?
    @State private var showPaywall = false
    @State private var exportedFileURL: URL?
    @State private var showShareSheet = false
    @State private var copiedToClipboard = false
    @State private var shareLink: String?
    @State private var isCreatingShareLink = false

    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 32))
                            .foregroundColor(.purple80)

                        Text("Export & Share")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text(note.title)
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                            .lineLimit(1)
                    }
                    .padding(.top, 24)
                    .padding(.bottom, 20)

                    // Free actions
                    VStack(spacing: 12) {
                        exportRow(
                            icon: "doc.on.clipboard",
                            title: "Copy to Clipboard",
                            subtitle: "Copy note text for pasting anywhere",
                            isPremium: false
                        ) {
                            copyToClipboard()
                        }

                        exportRow(
                            icon: "link",
                            title: "Create Share Link",
                            subtitle: shareLink != nil ? "Link copied!" : "Anyone with the link can view",
                            isPremium: false
                        ) {
                            createShareLink()
                        }
                    }
                    .padding(.horizontal, 16)

                    // Divider with label: EXPORT
                    sectionDivider("EXPORT")

                    // Premium export actions
                    VStack(spacing: 12) {
                        exportRow(
                            icon: "doc.richtext",
                            title: "Export as PDF",
                            subtitle: "Beautifully formatted document",
                            isPremium: true
                        ) {
                            handlePremiumExport(format: .pdf)
                        }

                        exportRow(
                            icon: "doc.text",
                            title: "Export as Word",
                            subtitle: "Editable DOCX document",
                            isPremium: true
                        ) {
                            handlePremiumExport(format: .docx)
                        }

                        exportRow(
                            icon: "envelope",
                            title: "Share via Email",
                            subtitle: "Send as PDF attachment",
                            isPremium: true
                        ) {
                            handlePremiumExport(format: .pdf)
                        }
                    }
                    .padding(.horizontal, 16)

                    // Divider with label: INTEGRATIONS
                    sectionDivider("INTEGRATIONS")

                    VStack(spacing: 12) {
                        exportRow(
                            icon: "externaldrive",
                            title: "Save to Google Drive",
                            subtitle: "Export as Google Doc",
                            isPremium: true
                        ) {
                            handleIntegrationExport(provider: "google_drive")
                        }
                    }
                    .padding(.horizontal, 16)

                    Spacer()

                    // Error message
                    if let error = exportError {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.red)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                    }
                }

                // Loading overlay
                if isExporting {
                    Color.black.opacity(0.4).ignoresSafeArea()
                    VStack(spacing: 16) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(1.2)
                        Text("Generating export...")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white)
                    }
                    .padding(32)
                    .background(Color.cardBackground)
                    .cornerRadius(16)
                }

                // Clipboard confirmation toast
                if copiedToClipboard {
                    VStack {
                        Spacer()
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Copied to clipboard")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.textPrimary)
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(Color.cardBackground)
                        .cornerRadius(25)
                        .shadow(radius: 8)
                        .padding(.bottom, 32)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.easeInOut(duration: 0.3), value: copiedToClipboard)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.purple80)
                }
            }
            .sheet(isPresented: $showShareSheet) {
                if let fileURL = exportedFileURL {
                    ShareSheet(items: [fileURL])
                }
            }
            .sheet(isPresented: $showPaywall) {
                NavigationView {
                    ScribeRemotePaywallView(triggerSource: "export_menu") {
                        showPaywall = false
                    }
                }
            }
        }
    }

    // MARK: - Section Divider

    @ViewBuilder
    private func sectionDivider(_ label: String) -> some View {
        HStack {
            Rectangle().fill(Color.darkSurfaceVariant).frame(height: 1)
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.textSecondary)
            Rectangle().fill(Color.darkSurfaceVariant).frame(height: 1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }

    // MARK: - Row Builder

    @ViewBuilder
    private func exportRow(icon: String, title: String, subtitle: String, isPremium: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(isPremium ? .purple80 : .textPrimary)
                    .frame(width: 36, height: 36)
                    .background(isPremium ? Color.purple80.opacity(0.12) : Color.darkSurfaceVariant.opacity(0.5))
                    .cornerRadius(10)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.textPrimary)

                        if isPremium && !gateManager.canAccessPremiumFeatures {
                            Image(systemName: "crown.fill")
                                .font(.system(size: 11))
                                .foregroundColor(.orange)
                        }
                    }

                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
            }
            .padding(14)
            .background(Color.cardBackground)
            .cornerRadius(12)
        }
        .disabled(isExporting)
    }

    // MARK: - Actions

    private func copyToClipboard() {
        UIPasteboard.general.string = note.displayContent
        // AnalyticsService.shared.trackEvent("export_clipboard", properties: ["note_id": note.id])

        withAnimation {
            copiedToClipboard = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                copiedToClipboard = false
            }
        }
    }

    private func createShareLink() {
        guard !isCreatingShareLink else { return }
        isCreatingShareLink = true
        exportError = nil

        Task {
            do {
                guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
                      let url = URL(string: "\(Constants.baseURL)/api/notes/\(note.id)/share") else {
                    throw ExportService.ExportError.noAuthToken
                }

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: [:])

                let (data, _) = try await URLSession.shared.data(for: request)
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let resultData = json["data"] as? [String: Any],
                   let shareUrl = resultData["shareUrl"] as? String {
                    await MainActor.run {
                        isCreatingShareLink = false
                        shareLink = shareUrl
                        UIPasteboard.general.string = shareUrl
                        withAnimation { copiedToClipboard = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation { copiedToClipboard = false }
                        }
                        // AnalyticsService.shared.trackEvent("share_link_created", properties: ["note_id": note.id])
                    }
                } else {
                    await MainActor.run {
                        isCreatingShareLink = false
                        exportError = "Failed to create share link"
                    }
                }
            } catch {
                await MainActor.run {
                    isCreatingShareLink = false
                    exportError = error.localizedDescription
                }
            }
        }
    }

    private func handleIntegrationExport(provider: String) {
        guard gateManager.canAccessPremiumFeatures else {
            AnalyticsService.shared.trackPaywallViewed(source: "integration_\(provider)")
            showPaywall = true
            return
        }

        isExporting = true
        exportError = nil

        Task {
            do {
                guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
                    throw ExportService.ExportError.noAuthToken
                }

                let endpoint: String
                switch provider {
                case "google_drive":
                    endpoint = "/api/integrations/google-drive/export/\(note.id)"
                case "notion":
                    endpoint = "/api/integrations/notion/export/\(note.id)"
                case "slack":
                    endpoint = "/api/integrations/slack/share/\(note.id)"
                default:
                    throw ExportService.ExportError.serverError("Unknown provider")
                }

                guard let url = URL(string: "\(Constants.baseURL)\(endpoint)") else {
                    throw ExportService.ExportError.invalidURL
                }

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: [:])

                let (data, response) = try await URLSession.shared.data(for: request)
                let httpResponse = response as? HTTPURLResponse

                await MainActor.run {
                    isExporting = false

                    if httpResponse?.statusCode == 400 {
                        // Not connected — tell user to connect in settings
                        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           let error = json["error"] as? String {
                            exportError = error
                        } else {
                            exportError = "\(provider.replacingOccurrences(of: "_", with: " ").capitalized) not connected. Connect in Settings."
                        }
                    } else if httpResponse?.statusCode == 403 {
                        showPaywall = true
                    } else if httpResponse?.statusCode == 200 {
                        // Success
                        withAnimation { copiedToClipboard = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation { copiedToClipboard = false }
                        }
                        // AnalyticsService.shared.trackEvent("integration_export_completed", properties: [
                        //     "note_id": note.id,
                        //     "provider": provider
                        // ])
                    } else {
                        exportError = "Export failed. Please try again."
                    }
                }
            } catch {
                await MainActor.run {
                    isExporting = false
                    exportError = error.localizedDescription
                }
            }
        }
    }

    private func handlePremiumExport(format: ExportService.ExportFormat) {
        // Check premium access
        guard gateManager.canAccessPremiumFeatures else {
            AnalyticsService.shared.trackPaywallViewed(source: "export_\(format.rawValue)")
            showPaywall = true
            return
        }

        // Proceed with export
        isExporting = true
        exportError = nil

        Task {
            do {
                let fileURL = try await ExportService.shared.exportNote(noteId: note.id, format: format)
                await MainActor.run {
                    isExporting = false
                    exportedFileURL = fileURL
                    showShareSheet = true
                    // AnalyticsService.shared.trackEvent("export_completed", properties: [
                    //     "note_id": note.id,
                    //     "format": format.rawValue
                    // ])
                }
            } catch {
                await MainActor.run {
                    isExporting = false
                    exportError = error.localizedDescription
                    // AnalyticsService.shared.trackEvent("export_failed", properties: [
                    //     "note_id": note.id,
                    //     "format": format.rawValue,
                    //     "error": error.localizedDescription
                    // ])
                }
            }
        }
    }
}
