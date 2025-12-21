//
//  TokenManager.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/27/25.
//


//
//  TokenManager.swift
//  scribeai
//
//  Centralized token management with automatic refresh
//

import Foundation

class TokenManager {
    static let shared = TokenManager()
    
    private var isRefreshing = false
    private var refreshQueue: [CheckedContinuation<String?, Never>] = []
    
    private init() {}
    
    /// Get a valid access token, refreshing if necessary
    /// Returns nil if no valid token available (user needs to sign in)
    func getValidToken() async -> String? {
        // Check if we have an access token
        guard let accessToken = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            print("🔑 No access token found")
            return nil
        }
        
        // Check if token is expired (JWT tokens have an exp claim)
        if isTokenExpired(accessToken) {
            print("🔑 Access token expired, attempting refresh...")
            return await refreshTokenIfNeeded()
        }
        
        return accessToken
    }
    
    /// Force refresh the token
    func refreshTokenIfNeeded() async -> String? {
        // If already refreshing, wait for the result
        if isRefreshing {
            print("🔑 Refresh already in progress, waiting...")
            return await withCheckedContinuation { continuation in
                refreshQueue.append(continuation)
            }
        }
        
        isRefreshing = true
        defer {
            isRefreshing = false
            // Resume all waiting continuations
            let newToken = KeychainService.shared.get(Constants.Keychain.accessToken)
            for continuation in refreshQueue {
                continuation.resume(returning: newToken)
            }
            refreshQueue.removeAll()
        }
        
        // Check if we have a refresh token
        guard KeychainService.shared.get(Constants.Keychain.refreshToken) != nil else {
            print("🔑 No refresh token found")
            return nil
        }
        
        do {
            // Use Supabase to refresh the session
            let session = try await SupabaseManager.shared.refreshSession()
            
            // Save new tokens
            KeychainService.shared.save(session.accessToken, forKey: Constants.Keychain.accessToken)
            KeychainService.shared.save(session.refreshToken, forKey: Constants.Keychain.refreshToken)
            
            print("✅ Token refreshed successfully")
            return session.accessToken
            
        } catch {
            print("❌ Token refresh failed: \(error)")
            // Clear tokens on refresh failure - user needs to sign in again
            // Don't clear here - let the calling code decide
            return nil
        }
    }
    
    /// Check if a JWT token is expired
    private func isTokenExpired(_ token: String) -> Bool {
        // JWT format: header.payload.signature
        let parts = token.components(separatedBy: ".")
        guard parts.count == 3 else {
            return true // Invalid token format
        }
        
        // Decode the payload (base64)
        var payload = parts[1]
        
        // Add padding if needed for base64 decoding
        let remainder = payload.count % 4
        if remainder > 0 {
            payload = payload.padding(toLength: payload.count + 4 - remainder, withPad: "=", startingAt: 0)
        }
        
        // Replace URL-safe characters
        payload = payload
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        
        guard let payloadData = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let exp = json["exp"] as? TimeInterval else {
            return true // Can't parse, assume expired
        }
        
        let expirationDate = Date(timeIntervalSince1970: exp)
        
        // Add a 30-second buffer to refresh before actual expiration
        let bufferSeconds: TimeInterval = 30
        let isExpired = Date().addingTimeInterval(bufferSeconds) >= expirationDate
        
        if isExpired {
            print("🔑 Token expires at \(expirationDate), refreshing early")
        }
        
        return isExpired
    }
    
    /// Clear all tokens (for sign out)
    func clearTokens() {
        KeychainService.shared.clear()
        print("🔑 All tokens cleared")
    }
}