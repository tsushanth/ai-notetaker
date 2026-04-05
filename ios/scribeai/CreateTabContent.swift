//
//  CreateTabContent.swift
//  scribeai
//
//  Create any content from notes using Claude AI
//

import SwiftUI
import WebKit

struct CreateTabContent: View {
    let note: Note
    @State private var token: String = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""

    var body: some View {
        CreateWebView(noteId: note.id, token: token)
            .ignoresSafeArea(edges: .bottom)
            .id(token) // Force recreate WebView when token changes
            .onAppear {
                // Refresh token each time tab appears
                let freshToken = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""
                if freshToken != token {
                    token = freshToken
                }
            }
    }
}

struct CreateWebView: UIViewRepresentable {
    let noteId: String
    let token: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 10/255, green: 10/255, blue: 11/255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor

        if let url = URL(string: "\(Constants.baseURL)/create/\(noteId)?token=\(token)") {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
