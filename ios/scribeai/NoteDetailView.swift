//
//  NoteDetailView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//  FIXED: Share sheet with app branding
//

import SwiftUI

struct NoteDetailView: View {
    let note: Note
    @ObservedObject var viewModel: NoteViewModel
    @Environment(\.dismiss) var dismiss
    @State private var showingDeleteAlert = false
    @State private var showingShareSheet = false
    @State private var showingExportMenu = false
    
    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Title
                    Text(note.title)
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(.textPrimary)
                        .padding(.horizontal)
                        .padding(.top)
                    
                    // Metadata
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "calendar")
                                .foregroundColor(.textSecondary)
                            Text(formatFullDate(note.createdAt))
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                        
                        if let sourceType = note.sourceType {
                            HStack {
                                Image(systemName: sourceIcon(sourceType))
                                    .foregroundColor(.textSecondary)
                                // FIX: Show proper source label
                                Text("Source: \(sourceLabel(sourceType))")
                                    .font(.system(size: 13))
                                    .foregroundColor(.textSecondary)
                            }
                        }
                        
                        HStack {
                            Image(systemName: "doc.text")
                                .foregroundColor(.textSecondary)
                            Text("\(note.content.count) characters • \(note.content.split(separator: " ").count) words")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                    }
                    .padding(.horizontal)
                    
                    Divider()
                        .background(Color.darkSurfaceVariant)
                        .padding(.horizontal)
                    
                    // Content
                    Text(note.content)
                        .font(.system(size: 16))
                        .foregroundColor(.textPrimary)
                        .lineSpacing(6)
                        .padding(.horizontal)
                    
                    Spacer(minLength: 32)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(action: {
                        showingExportMenu = true
                    }) {
                        Label("Export & Share", systemImage: "square.and.arrow.up")
                    }

                    Button(action: {
                        showingShareSheet = true
                    }) {
                        Label("Quick Share", systemImage: "paperplane")
                    }

                    Button(role: .destructive, action: {
                        showingDeleteAlert = true
                    }) {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundColor(.textPrimary)
                }
            }
        }
        .alert("Delete Note", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                deleteNote()
            }
        } message: {
            Text("Are you sure you want to delete this note? This action cannot be undone.")
        }
        .sheet(isPresented: $showingExportMenu) {
            ExportMenuView(note: note)
        }
        .sheet(isPresented: $showingShareSheet) {
            BrandedShareSheet(
                title: note.title,
                content: note.content,
                sourceType: note.sourceType
            )
        }
    }
    
    private func deleteNote() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            return
        }
        
        Task {
            await viewModel.deleteNote(token: token, noteId: note.id)
            dismiss()
        }
    }
    
    private func sourceIcon(_ type: String) -> String {
        switch type {
        case "video": return "video.fill"
        case "recording": return "mic.fill"
        case "pdf": return "doc.fill"
        case "scan": return "camera.fill"
        case "upload": return "arrow.up.doc.fill"
        default: return "doc.text.fill"
        }
    }
    
    // FIX: Add proper source labels
    private func sourceLabel(_ type: String) -> String {
        switch type {
        case "video": return "YouTube Video"
        case "recording": return "Audio Recording"
        case "pdf": return "PDF Document"
        case "scan": return "Scanned Document"
        case "upload": return "Uploaded File"
        default: return type.capitalized
        }
    }
    
    private func formatFullDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return dateString
        }
        
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .long
        dateFormatter.timeStyle = .short
        return dateFormatter.string(from: date)
    }
}

// MARK: - Branded Share Sheet
// FIX: Share sheet with app branding

struct BrandedShareSheet: UIViewControllerRepresentable {
    let title: String
    let content: String
    let sourceType: String?
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        // Create share content with branding
        let shareContent = """
\(title)

\(content)

---
📝 Created with SCRIBE AI
"""
        
        // Create activity items
        var activityItems: [Any] = [shareContent]
        
        // Add the app icon if available
        if let appIcon = UIImage(named: "AppIcon") {
            activityItems.append(appIcon)
        }
        
        let activityVC = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )
        
        // Set subject line for email sharing
        activityVC.setValue("📝 \(title) - SCRIBE AI", forKey: "subject")
        
        // Exclude some activity types if needed
        activityVC.excludedActivityTypes = [
            .addToReadingList,
            .assignToContact,
            .openInIBooks
        ]
        
        return activityVC
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Legacy Share Sheet (for backward compatibility)

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
