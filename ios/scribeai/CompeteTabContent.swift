//
//  CompeteTabContent.swift
//  scribeai
//
//  Create challenges from notes and compete with friends — full WebView
//

import SwiftUI

struct CompeteTabContent: View {
    let note: Note
    @State private var token: String = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""

    var body: some View {
        Group {
            if let url = URL(string: "\(Constants.baseURL)/compete-create/\(note.id)?token=\(token)") {
                LoadingWebView(url: url)
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .id(token)
        .onAppear {
            let freshToken = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""
            if freshToken != token { token = freshToken }
        }
    }
}
