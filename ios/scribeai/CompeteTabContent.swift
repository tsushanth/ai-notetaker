//
//  CompeteTabContent.swift
//  scribeai
//
//  Create challenges from notes and compete with friends — full WebView
//

import SwiftUI
import WebKit

struct CompeteTabContent: View {
    let note: Note
    @State private var token: String = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""

    var body: some View {
        CompeteWebView(noteId: note.id, token: token)
            .ignoresSafeArea(edges: .bottom)
            .id(token)
            .onAppear {
                let freshToken = KeychainService.shared.get(Constants.Keychain.accessToken) ?? ""
                if freshToken != token { token = freshToken }
            }
    }
}

struct CompeteWebView: UIViewRepresentable {
    let noteId: String
    let token: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 10/255, green: 10/255, blue: 11/255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor

        if let url = URL(string: "\(Constants.baseURL)/compete-create/\(noteId)?token=\(token)") {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
