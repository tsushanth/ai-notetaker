//
//  AddContentSheet.swift
//  scribeai
//
//  Bottom sheet shown when user taps "Add Content". Replaces the previous
//  text-only confirmationDialog. SwiftUI confirmationDialog ignores icon
//  content even via Label, so we render this as a custom .sheet instead.
//

import SwiftUI

enum AddContentOption: String, CaseIterable, Identifiable {
    case recordAudio
    case scanDocument
    case uploadFile
    case youtubeLink
    case joinMeeting
    case phoneCall

    var id: String { rawValue }

    var title: String {
        switch self {
        case .recordAudio:  return "Record Audio"
        case .scanDocument: return "Scan Document"
        case .uploadFile:   return "Upload PDF/Audio"
        case .youtubeLink:  return "YouTube Link"
        case .joinMeeting:  return "Join Meeting"
        case .phoneCall:    return "Phone Call"
        }
    }

    var caption: String {
        switch self {
        case .recordAudio:  return "Capture audio in-app"
        case .scanDocument: return "OCR a page or book"
        case .uploadFile:   return "From your library"
        case .youtubeLink:  return "Paste any video URL"
        case .joinMeeting:  return "Send a bot to Zoom, Meet, Teams"
        case .phoneCall:    return "Dial out and record"
        }
    }

    var iconName: String {
        switch self {
        case .recordAudio:  return "record_audio"
        case .scanDocument: return "scan_document"
        case .uploadFile:   return "upload_file"
        case .youtubeLink:  return "youtube_link"
        case .joinMeeting:  return "join_meeting"
        case .phoneCall:    return "phone_call"
        }
    }
}

struct AddContentSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onSelect: (AddContentOption) -> Void

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(AddContentOption.allCases) { option in
                        Button {
                            dismiss()
                            // Defer the callback by a tick so the sheet finishes
                            // dismissing before the host presents the next view.
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                onSelect(option)
                            }
                        } label: {
                            AddContentCard(option: option)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(Color.darkBackground.ignoresSafeArea())
            .navigationTitle("Add Content")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.purple80)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
    }
}

private struct AddContentCard: View {
    let option: AddContentOption

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(option.iconName)
                .resizable()
                .scaledToFit()
                .frame(width: 56, height: 56)
                .cornerRadius(12)

            Text(option.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.textPrimary)
                .lineLimit(1)

            Text(option.caption)
                .font(.system(size: 12))
                .foregroundColor(.textSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.06), lineWidth: 1)
        )
    }
}

#Preview {
    Color.darkBackground.sheet(isPresented: .constant(true)) {
        AddContentSheet { _ in }
    }
}
