//
//  NotesTabContent.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//
//  FIXED: Large note performance - uses chunked lazy loading
//


import SwiftUI

struct NotesTabContent: View {
    let note: Note

    // Cached word count to avoid recalculating
    private var wordCount: Int {
        // Use a simple approximation for very large content
        if note.content.count > 100000 {
            // Approximate: average word length is ~5 chars + 1 space
            return note.content.count / 6
        }
        return note.content.split(separator: " ").count
    }

    // For large notes, split into chunks for better performance
    private var contentChunks: [String] {
        let chunkSize = 5000 // characters per chunk
        guard note.content.count > chunkSize else {
            return [note.content]
        }

        var chunks: [String] = []
        var currentIndex = note.content.startIndex

        while currentIndex < note.content.endIndex {
            let endIndex = note.content.index(currentIndex, offsetBy: chunkSize, limitedBy: note.content.endIndex) ?? note.content.endIndex

            // Try to break at a space or newline for cleaner chunks
            var adjustedEnd = endIndex
            if endIndex < note.content.endIndex {
                // Look for a good break point (space or newline) within last 100 chars
                let searchStart = note.content.index(endIndex, offsetBy: -100, limitedBy: currentIndex) ?? currentIndex
                if let breakPoint = note.content[searchStart..<endIndex].lastIndex(where: { $0 == " " || $0 == "\n" }) {
                    adjustedEnd = note.content.index(after: breakPoint)
                }
            }

            chunks.append(String(note.content[currentIndex..<adjustedEnd]))
            currentIndex = adjustedEnd
        }

        return chunks
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
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
                            Text("Source: \(sourceType.capitalized)")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                    }

                    HStack {
                        Image(systemName: "doc.text")
                            .foregroundColor(.textSecondary)
                        Text("\(note.content.count.formatted()) characters • \(wordCount.formatted()) words")
                            .font(.system(size: 13))
                            .foregroundColor(.textSecondary)
                    }
                }
                .padding(.horizontal)
                .padding(.top)
                .padding(.bottom, 12)

                Divider()
                    .background(Color.darkSurfaceVariant)
                    .padding(.horizontal)
                    .padding(.bottom, 16)

                // Content - chunked for performance with large notes
                ForEach(Array(contentChunks.enumerated()), id: \.offset) { index, chunk in
                    Text(chunk)
                        .font(.system(size: 16))
                        .foregroundColor(.textPrimary)
                        .lineSpacing(6)
                        .padding(.horizontal)
                        .textSelection(.enabled)
                }

                Spacer(minLength: 32)
            }
        }
    }
    
    private func sourceIcon(_ type: String) -> String {
        switch type {
        case "video": return "video.fill"
        case "recording": return "mic.fill"
        case "pdf": return "doc.fill"
        case "scan": return "camera.fill"
        default: return "doc.text.fill"
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