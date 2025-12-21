//
//  SummaryTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/20/25.
//


//
//  SummaryTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//

import SwiftUI

struct SummaryTabContent: View {
    let note: Note
    @State private var summary: String?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var selectedLength: SummaryLength = .medium
    
    enum SummaryLength: String, CaseIterable {
        case short = "short"
        case medium = "medium"
        case long = "long"
        
        var displayName: String {
            rawValue.capitalized
        }
    }
    
    var body: some View {
        VStack(spacing: 20) {
            if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                    .scaleEffect(1.5)
            } else if isGenerating {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .purple80))
                        .scaleEffect(1.5)
                    
                    Text("Generating summary...")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                    
                    Text("Creating a \(selectedLength.rawValue) summary")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
                .frame(maxHeight: .infinity)
            } else if let summary = summary {
                // Summary Display
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            Text("Summary")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.purple80)
                            
                            Spacer()
                            
                            Button(action: {
                                generateSummary()
                            }) {
                                Image(systemName: "arrow.clockwise")
                                    .foregroundColor(.purple80)
                                    .padding(8)
                                    .background(Color.purple80.opacity(0.2))
                                    .clipShape(Circle())
                            }
                        }
                        
                        Text(summary)
                            .font(.system(size: 15))
                            .foregroundColor(.textPrimary)
                            .lineSpacing(6)
                            .padding()
                            .background(Color.cardBackground)
                            .cornerRadius(12)
                    }
                    .padding()
                }
            } else {
                // Generate Summary UI
                VStack(spacing: 24) {
                    Spacer()
                    
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.purple80)
                    
                    Text("Generate Summary")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.textPrimary)
                    
                    Text("Create a concise summary of your notes")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                    
                    // Length Selector
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Summary Length")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.textPrimary)
                        
                        HStack(spacing: 12) {
                            ForEach(SummaryLength.allCases, id: \.self) { length in
                                Button(action: {
                                    selectedLength = length
                                }) {
                                    Text(length.displayName)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundColor(selectedLength == length ? .darkBackground : .textPrimary)
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 10)
                                        .background(selectedLength == length ? Color.purple80 : Color.cardBackground)
                                        .cornerRadius(20)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 20)
                                                .stroke(selectedLength == length ? Color.clear : Color.darkSurfaceVariant, lineWidth: 1)
                                        )
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 32)
                    
                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.accentRed)
                            .padding()
                            .background(Color.accentRed.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal, 32)
                    }
                    
                    Button(action: {
                        generateSummary()
                    }) {
                        HStack {
                            Image(systemName: "sparkles")
                            Text("Generate Summary")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.purple80)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 32)
                    
                    Spacer()
                }
            }
        }
        .onAppear {
            loadSummary()
        }
    }
    
    private func loadSummary() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("❌ No auth token found")
            isLoading = false
            return
        }
        
        print("📝 Loading summary for note: \(note.id)")
        
        Task {
            do {
                let aiContent = try await APIService.shared.getAIContent(token: token, noteId: note.id, contentType: "summary")
                
                await MainActor.run {
                    if let summaryText = aiContent?.summary {
                        print("✅ Summary loaded")
                        self.summary = summaryText
                    } else {
                        print("ℹ️ No summary found")
                    }
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    print("❌ Error loading summary: \(error)")
                    self.errorMessage = "Failed to load summary: \(error.localizedDescription)"
                }
            }
        }
    }
    
    private func generateSummary() {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            errorMessage = "Not authenticated"
            return
        }
        
        isGenerating = true
        errorMessage = nil
        
        Task {
            do {
                let aiContent = try await APIService.shared.generateSummary(
                    token: token,
                    noteId: note.id,
                    length: selectedLength.rawValue,
                    contentLength: note.content.count
                )
                
                await MainActor.run {
                    print("✅ Summary generated")
                    self.summary = aiContent.summary
                    self.isGenerating = false
                }
            } catch {
                await MainActor.run {
                    print("❌ Error generating summary: \(error)")
                    self.errorMessage = "Failed to generate summary: \(error.localizedDescription)"
                    self.isGenerating = false
                }
            }
        }
    }
}