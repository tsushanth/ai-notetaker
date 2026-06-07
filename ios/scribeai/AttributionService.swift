//
//  AttributionService.swift
//  scribeai
//
//  Fetches the AdServices attribution token (iOS 14.3+) and POSTs it to
//  Apple's attribution endpoint so Apple Search Ads install/conversion
//  events register against this install. Idempotent: only sent once per
//  install, gated by UserDefaults.
//

import Foundation
import AdServices

final class AttributionService {
    static let shared = AttributionService()

    private let sentKey = "asa.attribution.sent"
    private let attributionURL = URL(string: "https://api-adservices.apple.com/api/v1/")!

    private init() {}

    /// Fetches the AdServices attribution token and POSTs it to Apple's
    /// attribution endpoint. Safe to call on every launch — sends at most
    /// once per install. Silent on failure (limited tracking, TestFlight,
    /// or transient network issues).
    func checkAdServicesAttribution() {
        guard !UserDefaults.standard.bool(forKey: sentKey) else { return }
        let sentKey = self.sentKey
        let url = self.attributionURL
        Task.detached(priority: .background) {
            do {
                let token = try AAAttribution.attributionToken()
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.setValue("text/plain", forHTTPHeaderField: "Content-Type")
                req.httpBody = token.data(using: .utf8)
                _ = try await URLSession.shared.data(for: req)
                UserDefaults.standard.set(true, forKey: sentKey)
            } catch {
                // Limited tracking, TestFlight, or network — silent
            }
        }
    }
}
