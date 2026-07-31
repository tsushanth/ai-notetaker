//
//  LoadingWebView.swift
//  scribeai
//
//  WKWebView wrapper that shows a dark-themed loading spinner overlay until the
//  first page load completes. Used by the Create, Compete, and Learn tabs.
//

import SwiftUI
import WebKit

struct LoadingWebView: View {
    let url: URL
    @State private var isLoading = true

    var body: some View {
        ZStack {
            Color(red: 10/255, green: 10/255, blue: 11/255)
                .ignoresSafeArea()

            _LoadingWebViewRepresentable(url: url, isLoading: $isLoading)

            if isLoading {
                VStack(spacing: 14) {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white.opacity(0.8))
                        .scaleEffect(1.2)
                    Text("Loading…")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.6))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 10/255, green: 10/255, blue: 11/255))
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: isLoading)
    }
}

private struct _LoadingWebViewRepresentable: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(isLoading: $isLoading) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 10/255, green: 10/255, blue: 11/255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.navigationDelegate = context.coordinator

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var isLoading: Bool
        init(isLoading: Binding<Bool>) { self._isLoading = isLoading }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }
    }
}
