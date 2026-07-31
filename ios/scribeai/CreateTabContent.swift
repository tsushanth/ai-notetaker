//
//  CreateTabContent.swift
//  scribeai
//
//  Create any content from notes using Claude AI
//

import SwiftUI

struct CreateTabContent: View {
    let note: Note
    @State private var token: String = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""

    var body: some View {
        Group {
            if let url = URL(string: "\(Constants.baseURL)/create/\(note.id)?token=\(token)") {
                LoadingWebView(url: url)
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .id(token) // Force recreate WebView when token changes
        .onAppear {
            let freshToken = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""
            if freshToken != token {
                token = freshToken
            }
        }
    }
}
