//
//  ScannerView.swift
//  scribeai
//
//  Updated with step-by-step processing UI
//

import SwiftUI
import VisionKit
import Vision
import PDFKit

// MARK: - Scanner View with Processing

struct ScannerViewWithProcessing: View {
    let onComplete: (String?) -> Void
    let onError: (String) -> Void
    let onCancel: () -> Void
    
    @Environment(\.dismiss) var dismiss
    
    @State private var showingScanner = true
    @State private var processingState: ScribeProcessingState = .idle
    @State private var processingSteps: [ScribeProcessingStep] = []
    @State private var currentStepIndex = 0
    @State private var uploadComplete = false
    @State private var scannedImages: [UIImage] = []
    
    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()
            
            switch processingState {
            case .idle:
                if showingScanner {
                    ScannerViewRepresentable(
                        onScan: { images in
                            scannedImages = images
                            showingScanner = false
                            processScannedImages()
                        },
                        onCancel: {
                            onCancel()
                        }
                    )
                    .ignoresSafeArea()
                }
                
            case .processing:
                VStack {
                    // Header
                    HStack {
                        Button(action: {
                            if uploadComplete {
                                onCancel()
                            }
                        }) {
                            Image(systemName: "xmark")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.textPrimary)
                                .padding()
                        }
                        .opacity(uploadComplete ? 1 : 0.5)
                        .disabled(!uploadComplete)
                        
                        Spacer()
                    }
                    
                    ScribeProcessingStepsView(
                        steps: processingSteps,
                        currentIndex: currentStepIndex,
                        uploadComplete: uploadComplete
                    )
                }
                
            case .success(let noteId):
                ScribeSuccessView(
                    onViewNote: {
                        print("📱 View Note tapped, noteId: \(noteId ?? "nil")")
                        onComplete(noteId)
                    },
                    onGoHome: {
                        print("📱 Go Home tapped")
                        onComplete(noteId)
                    }
                )
                
            case .error(let message):
                ScribeErrorView(
                    message: message,
                    onRetry: {
                        showingScanner = true
                        processingState = .idle
                    },
                    onGoBack: {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            onCancel()
                        }
                    }
                )
            }
        }
    }
    
    // MARK: - Processing
    
    private func processScannedImages() {
        guard !scannedImages.isEmpty else {
            onError("No images scanned")
            return
        }
        
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            onError("Not authenticated")
            return
        }
        
        // Initialize processing steps
        processingSteps = ScribeScanStep.allCases.map {
            ScribeProcessingStep(title: $0.title, status: .pending)
        }
        currentStepIndex = 0
        uploadComplete = false
        processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
        
        Task {
            var pdfURL: URL? = nil
            
            do {
                // Step 1: Uploading (preparing and uploading)
                await updateStep(at: 0, to: .inProgress)
                
                // Extract text from images using Vision
                var extractedText = ""
                for image in scannedImages {
                    if let text = extractText(from: image) {
                        extractedText += text + "\n\n"
                    }
                }
                
                print("📝 Extracted text length: \(extractedText.count) characters")
                
                // Create PDF from images
                pdfURL = try createPDF(from: scannedImages)
                print("📄 Created PDF at: \(pdfURL?.path ?? "unknown")")
                
                // Upload to backend - returns a Note object directly
                let note = try await APIService.shared.uploadScannedDocument(
                    token: token,
                    pdfURL: pdfURL!,
                    extractedText: extractedText
                )
                
                print("✅ Upload successful, note_id: \(note.id)")
                
                await updateStep(at: 0, to: .completed)
                uploadComplete = true
                
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
                    // Use the note.id directly from the response
                    processingState = .success(noteId: note.id)
                }
                
            } catch let error as NSError {
                print("❌ Upload error: \(error)")
                print("❌ Error domain: \(error.domain)")
                print("❌ Error code: \(error.code)")
                print("❌ Error userInfo: \(error.userInfo)")
                
                // Clean up temp file on error
                if let url = pdfURL {
                    try? FileManager.default.removeItem(at: url)
                }
                
                await MainActor.run {
                    // Provide more specific error message
                    let message: String
                    if error.domain == NSURLErrorDomain {
                        switch error.code {
                        case NSURLErrorNotConnectedToInternet:
                            message = "No internet connection. Please check your network and try again."
                        case NSURLErrorTimedOut:
                            message = "Request timed out. Please try again."
                        case NSURLErrorCancelled:
                            message = "Upload was cancelled."
                        default:
                            message = "Network error: \(error.localizedDescription)"
                        }
                    } else {
                        message = "Failed to process scanned document: \(error.localizedDescription)"
                    }
                    processingState = .error(message: message)
                    ErrorReportingService.shared.reportError(flow: .scanDocument, error: error)
                }
            }
        }
    }
    
    @MainActor
    private func updateStep(at index: Int, to status: ScribeProcessingStep.ScribeStepStatus) {
        guard index < processingSteps.count else { return }
        processingSteps[index].status = status
        currentStepIndex = index
        processingState = .processing(steps: processingSteps, currentIndex: index, uploadComplete: uploadComplete)
    }
    
    // MARK: - OCR
    
    private func extractText(from image: UIImage) -> String? {
        guard let cgImage = image.cgImage else { return nil }
        
        var extractedText = ""
        let semaphore = DispatchSemaphore(value: 0)
        
        let request = VNRecognizeTextRequest { request, error in
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                semaphore.signal()
                return
            }
            
            for observation in observations {
                if let topCandidate = observation.topCandidates(1).first {
                    extractedText += topCandidate.string + "\n"
                }
            }
            semaphore.signal()
        }
        
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        DispatchQueue.global(qos: .userInitiated).async {
            try? handler.perform([request])
        }
        
        semaphore.wait()
        return extractedText.isEmpty ? nil : extractedText
    }
    
    // MARK: - PDF Creation
    
    private func createPDF(from images: [UIImage]) throws -> URL {
        let pdfDocument = PDFDocument()
        
        for (index, image) in images.enumerated() {
            if let pdfPage = PDFPage(image: image) {
                pdfDocument.insert(pdfPage, at: index)
            }
        }
        
        let documentsPath = FileManager.default.temporaryDirectory
        let pdfURL = documentsPath.appendingPathComponent("scan_\(Date().timeIntervalSince1970).pdf")
        
        pdfDocument.write(to: pdfURL)
        
        return pdfURL
    }
}

// MARK: - Scanner View Representable

struct ScannerViewRepresentable: UIViewControllerRepresentable {
    let onScan: ([UIImage]) -> Void
    let onCancel: () -> Void
    
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let scanner = VNDocumentCameraViewController()
        scanner.delegate = context.coordinator
        return scanner
    }
    
    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan, onCancel: onCancel)
    }
    
    class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onScan: ([UIImage]) -> Void
        let onCancel: () -> Void
        
        init(onScan: @escaping ([UIImage]) -> Void, onCancel: @escaping () -> Void) {
            self.onScan = onScan
            self.onCancel = onCancel
        }
        
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            var images: [UIImage] = []
            for pageIndex in 0..<scan.pageCount {
                images.append(scan.imageOfPage(at: pageIndex))
            }
            onScan(images)
        }
        
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onCancel()
        }
        
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            print("Scanner error: \(error)")
            onCancel()
        }
    }
}

// MARK: - Legacy Scanner View (for backward compatibility)

struct ScannerView: UIViewControllerRepresentable {
    @Environment(\.dismiss) var dismiss
    
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let scanner = VNDocumentCameraViewController()
        scanner.delegate = context.coordinator
        return scanner
    }
    
    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }
    
    class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let parent: ScannerView
        
        init(parent: ScannerView) {
            self.parent = parent
        }
        
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            processScan(scan)
            parent.dismiss()
        }
        
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            parent.dismiss()
        }
        
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            print("Scanner error: \(error)")
            parent.dismiss()
        }
        
        private func processScan(_ scan: VNDocumentCameraScan) {
            guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
                return
            }
            
            var extractedText = ""
            
            for pageIndex in 0..<scan.pageCount {
                let image = scan.imageOfPage(at: pageIndex)
                
                if let text = extractText(from: image) {
                    extractedText += text + "\n\n"
                }
            }
            
            Task {
                do {
                    let pdfURL = try await createPDF(from: scan)
                    
                    _ = try await APIService.shared.uploadScannedDocument(
                        token: token,
                        pdfURL: pdfURL,
                        extractedText: extractedText
                    )
                } catch {
                    print("Upload error: \(error)")
                }
            }
        }
        
        private func extractText(from image: UIImage) -> String? {
            guard let cgImage = image.cgImage else { return nil }
            
            var extractedText = ""
            let semaphore = DispatchSemaphore(value: 0)
            
            let request = VNRecognizeTextRequest { request, error in
                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    semaphore.signal()
                    return
                }
                
                for observation in observations {
                    if let topCandidate = observation.topCandidates(1).first {
                        extractedText += topCandidate.string + "\n"
                    }
                }
                semaphore.signal()
            }
            
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            
            DispatchQueue.global(qos: .userInitiated).async {
                try? handler.perform([request])
            }
            
            semaphore.wait()
            return extractedText.isEmpty ? nil : extractedText
        }
        
        private func createPDF(from scan: VNDocumentCameraScan) async throws -> URL {
            let pdfDocument = PDFDocument()
            
            for pageIndex in 0..<scan.pageCount {
                let image = scan.imageOfPage(at: pageIndex)
                if let pdfPage = PDFPage(image: image) {
                    pdfDocument.insert(pdfPage, at: pageIndex)
                }
            }
            
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let pdfURL = documentsPath.appendingPathComponent("scan_\(Date().timeIntervalSince1970).pdf")
            
            pdfDocument.write(to: pdfURL)
            
            return pdfURL
        }
    }
}
