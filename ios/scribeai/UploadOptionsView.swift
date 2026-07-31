//
//  UploadOptionsView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati
//  FIXED: Permission denied on audio file upload
//  FIXED: Upload header text visibility
//

import SwiftUI
import PDFKit
import Vision
import VisionKit
import UniformTypeIdentifiers
import PhotosUI

enum UploadType {
    case pdf
    case audio
    case scan
    case photoLibrary
}

struct UploadOptionsView: View {
    @Environment(\.dismiss) private var dismiss
    
    @State private var showingDocumentPicker = false
    @State private var showingAudioPicker = false
    @State private var showingScanner = false
    @State private var currentUploadType: UploadType = .pdf
    
    // Processing state
    @State private var processingState: ScribeProcessingState = .idle
    @State private var processingSteps: [ScribeProcessingStep] = []
    @State private var currentStepIndex: Int = 0
    @State private var uploadComplete: Bool = false
    @State private var createdNoteId: String? = nil
    
    // OCR processing for scanned PDFs
    @State private var isCheckingPDF = false
    @State private var ocrProgress: String = ""

    // Photo library picker
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var showNoTextAlert = false
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()
                
                switch processingState {
                case .idle:
                    optionsContent
                    
                case .processing(let steps, let currentIndex, let uploadComplete):
                    ScribeProcessingStepsView(
                        steps: steps,
                        currentIndex: currentIndex,
                        uploadComplete: uploadComplete
                    )
                    
                case .success(let noteId):
                    ScribeSuccessView(
                        onViewNote: {
                            // Navigate to note
                            dismiss()
                        },
                        onGoHome: {
                            dismiss()
                        }
                    )
                    
                case .error(let message):
                    ScribeErrorView(
                        message: message,
                        onRetry: {
                            processingState = .idle
                        },
                        onGoBack: {
                            dismiss()
                        }
                    )
                }
                
                // OCR checking overlay
                if isCheckingPDF {
                    Color.black.opacity(0.5)
                        .ignoresSafeArea()
                    
                    VStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(1.5)
                            .tint(.white)
                        
                        Text("Analyzing document...")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        if !ocrProgress.isEmpty {
                            Text(ocrProgress)
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.8))
                        }
                    }
                    .padding(32)
                    .background(Color.black.opacity(0.7))
                    .cornerRadius(16)
                }
            }
            // FIX: Explicit title with proper styling
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        dismiss()
                    }) {
                        Text("Cancel")
                            .foregroundColor(.textPrimary)
                    }
                }
                
                // FIX: Add visible title in toolbar
                ToolbarItem(placement: .principal) {
                    Text("Upload")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.textPrimary)
                }
            }
            .sheet(isPresented: $showingDocumentPicker) {
                DocumentPicker(
                    allowedContentTypes: [.pdf],
                    onDocumentsPicked: { urls in
                        handleDocumentSelection(urls)
                    }
                )
            }
            .sheet(isPresented: $showingAudioPicker) {
                DocumentPicker(
                    allowedContentTypes: [.audio, .mpeg4Audio, .mp3, UTType(filenameExtension: "m4a")].compactMap { $0 },
                    onDocumentsPicked: { urls in
                        handleAudioSelection(urls)
                    }
                )
            }
            .fullScreenCover(isPresented: $showingScanner) {
                ScannerView()
            }
            .alert("No Text Found", isPresented: $showNoTextAlert) {
                Button("OK", role: .cancel) {
                    selectedPhotos = []
                }
            } message: {
                Text("The selected photos don't appear to contain any readable text. Please select photos that contain documents, notes, or other text content.")
            }
        }
        .navigationViewStyle(.stack)
        .preferredColorScheme(.dark)
    }
    
    // MARK: - Options Content
    
    private var optionsContent: some View {
        VStack(spacing: 16) {
            Spacer()
                .frame(height: 32)
            
            Text("Choose what you'd like to upload")
                .font(.system(size: 14))
                .foregroundColor(.textSecondary)
            
            Spacer()
                .frame(height: 32)
            
            // PDF Upload
            UploadOptionCard(
                icon: "doc.fill",
                title: "Upload PDF",
                description: "Extract text from PDF documents",
                color: .blue
            ) {
                currentUploadType = .pdf
                showingDocumentPicker = true
            }
            
            // Audio Upload
            UploadOptionCard(
                icon: "waveform",
                title: "Upload Audio",
                description: "Transcribe audio files",
                color: .purple80
            ) {
                currentUploadType = .audio
                showingAudioPicker = true
            }
            
            // Camera Roll / Photo Library
            PhotosPicker(
                selection: $selectedPhotos,
                maxSelectionCount: 10,
                matching: .images,
                photoLibrary: .shared()
            ) {
                UploadOptionCardContent(
                    icon: "photo.on.rectangle",
                    title: "Upload from Camera Roll",
                    description: "Select photos with text to extract",
                    color: .orange
                )
            }
            .onChange(of: selectedPhotos) { newValue in
                if !newValue.isEmpty {
                    currentUploadType = .photoLibrary
                    handlePhotoSelection(newValue)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 24)
    }
    
    // MARK: - Document Handling
    
    private func handleDocumentSelection(_ urls: [URL]) {
        guard let url = urls.first,
              let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            return
        }
        
        // First, check if the PDF has extractable text
        Task {
            await MainActor.run {
                isCheckingPDF = true
                ocrProgress = "Checking document type..."
            }
            
            let hasText = await checkPDFHasExtractableText(url: url)
            
            if hasText {
                // PDF has text - use regular upload
                await MainActor.run {
                    isCheckingPDF = false
                    ocrProgress = ""
                }
                await uploadPDFNormally(url: url, token: token)
            } else {
                // PDF is scanned/image-based - extract text with OCR and use scan endpoint
                await MainActor.run {
                    ocrProgress = "Scanned PDF detected, extracting text..."
                }
                await processScannedPDF(url: url, token: token)
            }
        }
    }
    
    /// Check if PDF has extractable text (returns true if text-based, false if scanned/image-based)
    private func checkPDFHasExtractableText(url: URL) async -> Bool {
        guard url.startAccessingSecurityScopedResource() else {
            return false
        }
        defer { url.stopAccessingSecurityScopedResource() }
        
        guard let document = PDFDocument(url: url) else {
            return false
        }
        
        // Check first few pages for text
        let pagesToCheck = min(document.pageCount, 3)
        var totalTextLength = 0
        
        for i in 0..<pagesToCheck {
            if let page = document.page(at: i),
               let text = page.string {
                let cleanedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
                totalTextLength += cleanedText.count
            }
        }
        
        // If we found more than 100 characters across checked pages, it's likely text-based
        // This threshold helps avoid false positives from OCR metadata or headers
        print("📄 PDF text check: found \(totalTextLength) characters in first \(pagesToCheck) pages")
        return totalTextLength > 100
    }
    
    /// Upload PDF normally (text-based PDF)
    private func uploadPDFNormally(url: URL, token: String) async {
        await MainActor.run {
            // Initialize processing steps for PDF
            processingSteps = ScribeDocumentStep.allCases.map {
                ScribeProcessingStep(title: $0.title, status: .pending)
            }
            currentStepIndex = 0
            uploadComplete = false
            processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
        }

        // Files app provides security-scoped URLs. checkPDFHasExtractableText
        // already started+stopped its own scope above, so we have to start a
        // new one before the multipart upload reads the file or
        // `Data(contentsOf:)` throws a permission error and the upload fails
        // before hitting the backend.
        let didStartScope = url.startAccessingSecurityScopedResource()
        defer { if didStartScope { url.stopAccessingSecurityScopedResource() } }

        do {
            // Step 1: Uploading
            await updateStep(at: 0, to: .inProgress)

            _ = try await APIService.shared.uploadPDF(token: token, fileURL: url)
            
            await updateStep(at: 0, to: .completed)
            uploadComplete = true
            
            // Animate through remaining steps
            for i in 1..<processingSteps.count {
                await updateStep(at: i, to: .inProgress)
                try await Task.sleep(nanoseconds: 800_000_000)
                await updateStep(at: i, to: .completed)
            }
            
            await MainActor.run {
                processingState = .success(noteId: nil)
            }
            
        } catch {
            await MainActor.run {
                var errorMessage = "Failed to upload PDF: \(error.localizedDescription)"
                
                // Check for specific error messages and provide helpful suggestions
                let errorString = error.localizedDescription.lowercased()
                if errorString.contains("could not extract text") ||
                   errorString.contains("no text") ||
                   errorString.contains("extract text") {
                    errorMessage = "This PDF appears to be image-based. The automatic OCR detection may have failed. Please try using 'Scan Document' instead."
                } else if errorString.contains("encrypted") || errorString.contains("protected") {
                    errorMessage = "This PDF is password-protected. Please remove the password protection and try again."
                } else if errorString.contains("too large") || errorString.contains("413") {
                    errorMessage = "This PDF is too large. Please try a smaller file (max 50MB)."
                }
                
                processingState = .error(message: errorMessage)
            }
        }
    }
    
    /// Process scanned PDF using OCR
    private func processScannedPDF(url: URL, token: String) async {
        guard url.startAccessingSecurityScopedResource() else {
            await MainActor.run {
                isCheckingPDF = false
                processingState = .error(message: "Could not access the PDF file")
            }
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        
        guard let document = PDFDocument(url: url) else {
            await MainActor.run {
                isCheckingPDF = false
                processingState = .error(message: "Could not open the PDF file")
            }
            return
        }
        
        let pageCount = document.pageCount
        var allExtractedText: [String] = []
        
        // Extract text from each page using Vision OCR
        for pageIndex in 0..<pageCount {
            await MainActor.run {
                ocrProgress = "Extracting text from page \(pageIndex + 1) of \(pageCount)..."
            }
            
            guard let page = document.page(at: pageIndex) else { continue }
            
            // Render page to image
            let pageRect = page.bounds(for: .mediaBox)
            let scale: CGFloat = 2.0 // Higher resolution for better OCR
            let imageSize = CGSize(width: pageRect.width * scale, height: pageRect.height * scale)
            
            let renderer = UIGraphicsImageRenderer(size: imageSize)
            let image = renderer.image { context in
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: imageSize))
                
                context.cgContext.translateBy(x: 0, y: imageSize.height)
                context.cgContext.scaleBy(x: scale, y: -scale)
                
                page.draw(with: .mediaBox, to: context.cgContext)
            }
            
            // Perform OCR on the page image
            if let pageText = await performOCR(on: image) {
                allExtractedText.append(pageText)
            }
        }
        
        let combinedText = allExtractedText.joined(separator: "\n\n")
        
        if combinedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            await MainActor.run {
                isCheckingPDF = false
                processingState = .error(message: "Could not extract any text from the scanned document. The images may be too blurry or the document may be empty.")
            }
            return
        }
        
        print("📄 OCR extracted \(combinedText.count) characters from \(pageCount) pages")
        
        await MainActor.run {
            isCheckingPDF = false
            ocrProgress = ""
            
            // Initialize processing steps for scanned document
            processingSteps = ScribeScanStep.allCases.map {
                ScribeProcessingStep(title: $0.title, status: .pending)
            }
            currentStepIndex = 0
            uploadComplete = false
            processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
        }
        
        // Now upload using the scan endpoint
        do {
            await updateStep(at: 0, to: .inProgress)
            
            let note = try await APIService.shared.uploadScannedDocument(
                token: token,
                pdfURL: url,
                extractedText: combinedText
            )
            
            await updateStep(at: 0, to: .completed)
            uploadComplete = true
            createdNoteId = note.id
            
            // Animate through remaining steps
            for i in 1..<processingSteps.count {
                await updateStep(at: i, to: .inProgress)
                try await Task.sleep(nanoseconds: 600_000_000)
                await updateStep(at: i, to: .completed)
            }
            
            await MainActor.run {
                processingState = .success(noteId: note.id)
            }
            
        } catch {
            await MainActor.run {
                processingState = .error(message: "Failed to upload scanned document: \(error.localizedDescription)")
            }
        }
    }
    
    /// Perform OCR on an image using Vision framework
    private func performOCR(on image: UIImage) async -> String? {
        guard let cgImage = image.cgImage else { return nil }
        
        return await withCheckedContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                guard error == nil,
                      let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(returning: nil)
                    return
                }
                
                let text = observations.compactMap { observation in
                    observation.topCandidates(1).first?.string
                }.joined(separator: "\n")
                
                continuation.resume(returning: text)
            }
            
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            
            do {
                try handler.perform([request])
            } catch {
                print("❌ OCR error: \(error)")
                continuation.resume(returning: nil)
            }
        }
    }
    
    // MARK: - Audio Handling
    // FIX: Updated with proper security-scoped resource handling
    
    private func handleAudioSelection(_ urls: [URL]) {
        guard let url = urls.first,
              let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            processingState = .error(message: "Not authenticated. Please log in again.")
            return
        }
        
        // FIX: Start security-scoped access for audio files
        guard url.startAccessingSecurityScopedResource() else {
            processingState = .error(message: "Permission denied. Cannot access the selected file. Please try selecting the file again.")
            return
        }
        
        // Initialize processing steps for audio
        processingSteps = ScribeRecordingStep.allCases.map {
            ScribeProcessingStep(title: $0.title, status: .pending)
        }
        currentStepIndex = 0
        uploadComplete = false
        processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
        
        Task {
            // FIX: Copy file to temp directory to avoid permission issues
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(url.lastPathComponent)
            
            do {
                // Remove existing temp file if present
                try? FileManager.default.removeItem(at: tempURL)
                
                // Copy to temp location
                try FileManager.default.copyItem(at: url, to: tempURL)
                
                // Now we can stop accessing the security-scoped resource
                url.stopAccessingSecurityScopedResource()
                
                // Step 1: Uploading
                await updateStep(at: 0, to: .inProgress)
                
                let recording = try await APIService.shared.uploadRecording(token: token, fileURL: tempURL)
                
                // Clean up temp file after upload
                try? FileManager.default.removeItem(at: tempURL)
                
                await updateStep(at: 0, to: .completed)
                uploadComplete = true
                
                // Step 2: Transcribing
                await updateStep(at: 1, to: .inProgress)
                
                let result = try await APIService.shared.transcribeRecording(token: token, recordingId: recording.id)
                
                await updateStep(at: 1, to: .completed)
                createdNoteId = result.noteId
                
                // Animate through remaining steps
                for i in 2..<processingSteps.count {
                    await updateStep(at: i, to: .inProgress)
                    try await Task.sleep(nanoseconds: 800_000_000)
                    await updateStep(at: i, to: .completed)
                }
                
                await MainActor.run {
                    processingState = .success(noteId: result.noteId)
                }
                
            } catch {
                // Make sure to stop accessing even on error
                url.stopAccessingSecurityScopedResource()
                
                // Clean up temp file on error
                try? FileManager.default.removeItem(at: tempURL)
                
                await MainActor.run {
                    var errorMessage = "Failed to process audio: \(error.localizedDescription)"
                    
                    // Provide more helpful error messages
                    let errorString = error.localizedDescription.lowercased()
                    if errorString.contains("permission") || errorString.contains("denied") {
                        errorMessage = "Permission denied. Please try selecting the file again or choose a different file."
                    } else if errorString.contains("format") || errorString.contains("codec") {
                        errorMessage = "Unsupported audio format. Please use MP3, M4A, or WAV files."
                    } else if errorString.contains("too large") || errorString.contains("413") {
                        errorMessage = "Audio file is too large. Please try a smaller file."
                    }
                    
                    processingState = .error(message: errorMessage)
                }
            }
        }
    }
    
    // MARK: - Photo Library Handling

    private func handlePhotoSelection(_ items: [PhotosPickerItem]) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            processingState = .error(message: "Not authenticated. Please log in again.")
            selectedPhotos = []
            return
        }

        Task {
            await MainActor.run {
                isCheckingPDF = true
                ocrProgress = "Loading selected photos..."
            }

            // Load images from PhotosPickerItems
            var loadedImages: [UIImage] = []
            for (index, item) in items.enumerated() {
                await MainActor.run {
                    ocrProgress = "Loading photo \(index + 1) of \(items.count)..."
                }

                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    loadedImages.append(image)
                }
            }

            guard !loadedImages.isEmpty else {
                await MainActor.run {
                    isCheckingPDF = false
                    ocrProgress = ""
                    selectedPhotos = []
                    processingState = .error(message: "Could not load the selected photos. Please try again.")
                }
                return
            }

            // Extract text from all images to validate they contain text
            await MainActor.run {
                ocrProgress = "Checking for text content..."
            }

            var allExtractedText: [String] = []
            for (index, image) in loadedImages.enumerated() {
                await MainActor.run {
                    ocrProgress = "Scanning photo \(index + 1) of \(loadedImages.count) for text..."
                }

                if let text = await performOCR(on: image) {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        allExtractedText.append(trimmed)
                    }
                }
            }

            let combinedText = allExtractedText.joined(separator: "\n\n")

            // Check if we found enough text (at least 20 characters to filter out noise)
            if combinedText.count < 20 {
                await MainActor.run {
                    isCheckingPDF = false
                    ocrProgress = ""
                    selectedPhotos = []
                    showNoTextAlert = true
                }
                return
            }

            print("📷 Extracted \(combinedText.count) characters from \(loadedImages.count) photos")

            await MainActor.run {
                isCheckingPDF = false
                ocrProgress = ""

                // Initialize processing steps for scanned images
                processingSteps = ScribeScanStep.allCases.map {
                    ScribeProcessingStep(title: $0.title, status: .pending)
                }
                currentStepIndex = 0
                uploadComplete = false
                processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
            }

            // Create PDF from images and upload
            var pdfURL: URL? = nil
            do {
                await updateStep(at: 0, to: .inProgress)

                // Create PDF from images
                pdfURL = try createPDF(from: loadedImages)
                print("📄 Created PDF at: \(pdfURL?.path ?? "unknown")")

                // Upload to backend
                let note = try await APIService.shared.uploadScannedDocument(
                    token: token,
                    pdfURL: pdfURL!,
                    extractedText: combinedText
                )

                print("✅ Upload successful, note_id: \(note.id)")

                await updateStep(at: 0, to: .completed)
                uploadComplete = true
                createdNoteId = note.id

                // Animate through remaining steps
                for i in 1..<processingSteps.count {
                    await updateStep(at: i, to: .inProgress)
                    try await Task.sleep(nanoseconds: 800_000_000)
                    await updateStep(at: i, to: .completed)
                }

                // Clean up temp file
                if let url = pdfURL {
                    try? FileManager.default.removeItem(at: url)
                }

                await MainActor.run {
                    selectedPhotos = []
                    processingState = .success(noteId: note.id)
                }

            } catch {
                print("❌ Photo upload error: \(error)")

                // Clean up temp file on error
                if let url = pdfURL {
                    try? FileManager.default.removeItem(at: url)
                }

                await MainActor.run {
                    selectedPhotos = []
                    processingState = .error(message: "Failed to process photos: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Create PDF from array of UIImages
    private func createPDF(from images: [UIImage]) throws -> URL {
        let pdfDocument = PDFDocument()

        for (index, image) in images.enumerated() {
            if let pdfPage = PDFPage(image: image) {
                pdfDocument.insert(pdfPage, at: index)
            }
        }

        let documentsPath = FileManager.default.temporaryDirectory
        let pdfURL = documentsPath.appendingPathComponent("photo_scan_\(Date().timeIntervalSince1970).pdf")

        pdfDocument.write(to: pdfURL)

        return pdfURL
    }

    // MARK: - Helper Methods

    @MainActor
    private func updateStep(at index: Int, to status: ScribeProcessingStep.ScribeStepStatus) {
        guard index < processingSteps.count else { return }
        processingSteps[index].status = status
        currentStepIndex = index
        processingState = .processing(steps: processingSteps, currentIndex: index, uploadComplete: uploadComplete)
    }
}

// MARK: - Upload Option Card

struct UploadOptionCard: View {
    let icon: String
    let title: String
    let description: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            UploadOptionCardContent(icon: icon, title: title, description: description, color: color)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Upload Option Card Content (for use with PhotosPicker)

struct UploadOptionCardContent: View {
    let icon: String
    let title: String
    let description: String
    let color: Color

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(color.opacity(0.2))
                    .frame(width: 60, height: 60)

                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundColor(color)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)

                Text(description)
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.textSecondary)
        }
        .padding(16)
        .background(Color.cardBackground)
        .cornerRadius(16)
    }
}

// MARK: - Document Picker

struct DocumentPicker: UIViewControllerRepresentable {
    let allowedContentTypes: [UTType]
    let onDocumentsPicked: ([URL]) -> Void
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: allowedContentTypes)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onDocumentsPicked: onDocumentsPicked)
    }
    
    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onDocumentsPicked: ([URL]) -> Void
        
        init(onDocumentsPicked: @escaping ([URL]) -> Void) {
            self.onDocumentsPicked = onDocumentsPicked
        }
        
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onDocumentsPicked(urls)
        }
    }
}

// MARK: - Preview

#Preview {
    UploadOptionsView()
}
