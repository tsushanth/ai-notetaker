//
//  InfographicTabContent.swift
//  scribeai
//
//  DALL-E 3 generated infographics for visual learning
//

import SwiftUI

struct InfographicTabContent: View {
    let note: Note
    @EnvironmentObject var viewModel: NoteViewModel
    @State private var infographic: Infographic?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var showPaywall = false
    @State private var selectedStyle: InfographicStyle = .modern
    @State private var showFullScreen = false

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                    .scaleEffect(1.5)
                    .frame(maxHeight: .infinity)
            } else if isGenerating {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(1.5)

                    Text("Creating your infographic...")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)

                    Text("This may take 30-60 seconds")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)

                    Text("AI is extracting key points and generating visuals")
                        .font(.system(size: 12))
                        .foregroundColor(.textTertiary)
                        .padding(.top, 8)
                }
                .frame(maxHeight: .infinity)
            } else if let infographic = infographic {
                // Infographic View
                ScrollView {
                    VStack(spacing: 16) {
                        // Header
                        HStack {
                            Text("AI Infographic")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(.textPrimary)

                            Spacer()

                            Button(action: {
                                self.infographic = nil
                                generateInfographic()
                            }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 12))
                                    Text("Regenerate")
                                        .font(.system(size: 13, weight: .medium))
                                }
                                .foregroundColor(.purple80)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                        // Infographic Image
                        Button(action: { showFullScreen = true }) {
                            AsyncImage(url: URL(string: infographic.imageUrl)) { phase in
                                switch phase {
                                case .empty:
                                    VStack(spacing: 12) {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                                        Text("Loading image...")
                                            .font(.system(size: 13))
                                            .foregroundColor(.textSecondary)
                                    }
                                    .frame(height: 400)
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fit)
                                        .cornerRadius(12)
                                case .failure:
                                    VStack(spacing: 12) {
                                        Image(systemName: "exclamationmark.triangle")
                                            .font(.system(size: 32))
                                            .foregroundColor(.accentRed)
                                        Text("Failed to load image")
                                            .font(.system(size: 14))
                                            .foregroundColor(.textSecondary)
                                    }
                                    .frame(height: 200)
                                @unknown default:
                                    EmptyView()
                                }
                            }
                        }
                        .buttonStyle(PlainButtonStyle())
                        .padding(.horizontal, 16)

                        // Tap to view hint
                        Text("Tap image to view full screen")
                            .font(.system(size: 12))
                            .foregroundColor(.textTertiary)

                        // Extracted Data Summary (if available)
                        if let extractedData = infographic.extractedData {
                            ExtractedDataSummaryView(data: extractedData)
                        }

                        // Share/Save buttons
                        HStack(spacing: 12) {
                            ShareLink(item: URL(string: infographic.imageUrl)!) {
                                HStack(spacing: 6) {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("Share")
                                }
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.purple80)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .background(Color.purple80.opacity(0.15))
                                .cornerRadius(22)
                            }

                            Button(action: { saveImageToPhotos() }) {
                                HStack(spacing: 6) {
                                    Image(systemName: "square.and.arrow.down")
                                    Text("Save")
                                }
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .background(Color.purple80)
                                .cornerRadius(22)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)

                        Spacer().frame(height: 20)
                    }
                }
            } else {
                // Generate Infographic UI
                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(Color.purple80.opacity(0.2))
                                    .frame(width: 100, height: 100)

                                Image(systemName: "chart.bar.doc.horizontal.fill")
                                    .font(.system(size: 50))
                                    .foregroundColor(.purple80)
                            }

                            Text("Generate Infographic")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundColor(.textPrimary)

                            Text("Create a visual summary of your notes")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 40)

                        // Style Selection
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Style")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundColor(.textPrimary)

                            HStack(spacing: 10) {
                                ForEach(InfographicStyle.allCases, id: \.self) { style in
                                    StyleOptionButton(
                                        style: style,
                                        isSelected: selectedStyle == style,
                                        action: { selectedStyle = style }
                                    )
                                }
                            }
                        }
                        .padding(16)
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .padding(.horizontal, 20)

                        // Features list
                        VStack(alignment: .leading, spacing: 12) {
                            InfographicFeatureRow(icon: "sparkles", text: "AI-generated visual design")
                            InfographicFeatureRow(icon: "chart.pie.fill", text: "Key statistics highlighted")
                            InfographicFeatureRow(icon: "list.bullet", text: "Main points summarized")
                            InfographicFeatureRow(icon: "square.and.arrow.down", text: "Save and share anywhere")
                        }
                        .padding(.horizontal, 20)

                        if let error = errorMessage {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.accentRed)
                                .padding()
                                .background(Color.accentRed.opacity(0.1))
                                .cornerRadius(8)
                                .padding(.horizontal, 20)
                        }

                        // Generate Button
                        Button(action: { generateInfographic() }) {
                            HStack {
                                Image(systemName: "sparkles")
                                Text("Generate Infographic")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.purple80)
                            .foregroundColor(.white)
                            .cornerRadius(28)
                        }
                        .padding(.horizontal, 20)

                        // Premium note
                        HStack(spacing: 6) {
                            Image(systemName: "crown.fill")
                                .font(.system(size: 12))
                            Text("Premium feature - requires subscription")
                                .font(.system(size: 12))
                        }
                        .foregroundColor(.textTertiary)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .onAppear {
            AnalyticsService.shared.track(.infographicTabViewed, properties: ["note_id": note.id])
            loadInfographic()
        }
        .sheet(isPresented: $showPaywall) {
            NavigationView {
                ScribeRemotePaywallView(triggerSource: "infographic_feature_gate") {
                    showPaywall = false
                    Task {
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showFullScreen) {
            if let infographic = infographic {
                InfographicFullScreenView(
                    imageUrl: infographic.imageUrl,
                    onDismiss: { showFullScreen = false }
                )
            }
        }
    }

    private func loadInfographic() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("No auth token found")
            isLoading = false
            return
        }

        Task {
            do {
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "infographic")
                await MainActor.run {
                    if let imageUrl = aiContent?.infographicImageUrl {
                        self.infographic = Infographic(
                            id: aiContent?.id ?? UUID().uuidString,
                            noteId: note.id,
                            imageUrl: imageUrl,
                            extractedData: aiContent?.infographicExtractedData,
                            style: aiContent?.infographicStyle,
                            createdAt: aiContent?.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    print("Error loading infographic: \(error)")
                }
            }
        }
    }

    private func generateInfographic() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }

        AnalyticsService.shared.track(.infographicGenerateStarted, properties: [
            "note_id": note.id,
            "style": selectedStyle.rawValue
        ])
        isGenerating = true
        errorMessage = nil

        Task {
            do {
                let aiContent = try await APIService.shared.generateInfographic(
                    token: token,
                    noteId: note.id,
                    contentLength: note.content.count,
                    style: selectedStyle.rawValue
                )
                await MainActor.run {
                    if let imageUrl = aiContent.infographicImageUrl {
                        self.infographic = Infographic(
                            id: aiContent.id ?? UUID().uuidString,
                            noteId: note.id,
                            imageUrl: imageUrl,
                            extractedData: aiContent.infographicExtractedData,
                            style: aiContent.infographicStyle,
                            createdAt: aiContent.createdAt ?? ISO8601DateFormatter().string(from: Date())
                        )
                        AnalyticsService.shared.track(.infographicGenerated, properties: [
                            "note_id": note.id,
                            "style": selectedStyle.rawValue
                        ])
                    }
                    self.isGenerating = false
                }
            } catch let error as APIError {
                print("❌ Infographic APIError: \(error)")
                await MainActor.run {
                    self.isGenerating = false
                    switch error {
                    case .subscriptionRequired, .freeTierLimitReached:
                        self.showPaywall = true
                    case .decodingError:
                        self.errorMessage = "Failed to process infographic data. Please try again."
                    default:
                        self.errorMessage = error.localizedDescription
                    }
                }
            } catch {
                print("❌ Infographic generation error: \(error)")
                await MainActor.run {
                    self.errorMessage = "Failed to generate infographic: \(error.localizedDescription)"
                    self.isGenerating = false
                }
            }
        }
    }

    private func saveImageToPhotos() {
        guard let infographic = infographic,
              let url = URL(string: infographic.imageUrl) else { return }

        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) {
                    UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                    AnalyticsService.shared.track(.infographicSaved, properties: ["note_id": note.id])
                }
            } catch {
                print("Failed to save image: \(error)")
            }
        }
    }
}

// MARK: - Supporting Models

struct Infographic: Identifiable {
    let id: String
    let noteId: String
    let imageUrl: String
    let extractedData: InfographicExtractedData?
    let style: String?
    let createdAt: String
}

enum InfographicStyle: String, CaseIterable {
    case modern = "modern"
    case colorful = "colorful"
    case minimal = "minimal"
    case professional = "professional"

    var displayName: String {
        rawValue.capitalized
    }

    var icon: String {
        switch self {
        case .modern: return "sparkles"
        case .colorful: return "paintpalette.fill"
        case .minimal: return "circle.grid.2x2"
        case .professional: return "briefcase.fill"
        }
    }
}

// MARK: - Supporting Views

struct StyleOptionButton: View {
    let style: InfographicStyle
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: style.icon)
                    .font(.system(size: 18))
                Text(style.displayName)
                    .font(.system(size: 11, weight: .medium))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 60)
            .background(isSelected ? Color.purple80.opacity(0.2) : Color.darkSurfaceVariant)
            .foregroundColor(isSelected ? .purple80 : .textSecondary)
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct InfographicFeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(.purple80)
                .frame(width: 24)

            Text(text)
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
        }
    }
}

struct ExtractedDataSummaryView: View {
    let data: InfographicExtractedData

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Title
            if let title = data.title {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Title")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.textTertiary)
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textPrimary)
                }
            }

            // Key Stats
            if let stats = data.keyStats, !stats.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Key Statistics")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.textTertiary)

                    HStack(spacing: 12) {
                        ForEach(stats.prefix(3), id: \.label) { stat in
                            VStack(spacing: 4) {
                                Text(stat.value)
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.purple80)
                                Text(stat.label)
                                    .font(.system(size: 11))
                                    .foregroundColor(.textSecondary)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.darkSurfaceVariant)
                            .cornerRadius(8)
                        }
                    }
                }
            }

            // Key Takeaway
            if let takeaway = data.keyTakeaway {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "lightbulb.fill")
                            .font(.system(size: 12))
                        Text("Key Takeaway")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(.accentGreen)

                    Text(takeaway)
                        .font(.system(size: 14))
                        .foregroundColor(.textPrimary)
                        .lineSpacing(3)
                }
                .padding(12)
                .background(Color.accentGreen.opacity(0.1))
                .cornerRadius(10)
            }
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(12)
        .padding(.horizontal, 16)
    }
}

// MARK: - Full Screen View

struct InfographicFullScreenView: View {
    let imageUrl: String
    let onDismiss: () -> Void
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            AsyncImage(url: URL(string: imageUrl)) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(scale)
                        .offset(offset)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    let delta = value / lastScale
                                    lastScale = value
                                    scale = min(max(scale * delta, 1), 4)
                                }
                                .onEnded { _ in
                                    lastScale = 1.0
                                }
                        )
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    offset = CGSize(
                                        width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height
                                    )
                                }
                                .onEnded { _ in
                                    lastOffset = offset
                                }
                        )
                        .onTapGesture(count: 2) {
                            withAnimation(.spring()) {
                                if scale > 1 {
                                    scale = 1
                                    offset = .zero
                                    lastOffset = .zero
                                } else {
                                    scale = 2
                                }
                            }
                        }
                case .failure:
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 40))
                            .foregroundColor(.gray)
                        Text("Failed to load image")
                            .foregroundColor(.gray)
                    }
                @unknown default:
                    EmptyView()
                }
            }

            // Close button
            VStack {
                HStack {
                    Spacer()
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding(20)
                }
                Spacer()
            }
        }
    }
}
