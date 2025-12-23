import Foundation
import Supabase

class SupabaseManager {
    static let shared = SupabaseManager()

    let client: SupabaseClient

    private init() {
        guard let supabaseURL = URL(string: Constants.supabaseURL) else {
            fatalError("Invalid Supabase URL configuration")
        }
        client = SupabaseClient(
            supabaseURL: supabaseURL,
            supabaseKey: Constants.supabaseAnonKey
        )
    }
    
    // Sign in with email/password
    func signIn(email: String, password: String) async throws -> AuthResponse {
        // Supabase returns Session directly
        let session = try await client.auth.signIn(email: email, password: password)
        
        // Save tokens from Session
        KeychainService.shared.save(session.accessToken, forKey: Constants.Keychain.accessToken)
        KeychainService.shared.save(session.refreshToken, forKey: Constants.Keychain.refreshToken)
        KeychainService.shared.save(session.user.id.uuidString, forKey: Constants.Keychain.userId)
        
        // Convert to our AuthResponse model
        return AuthResponse(
            success: true,
            data: AuthData(
                user: User(
                    id: session.user.id.uuidString,
                    email: session.user.email ?? "",
                    name: session.user.userMetadata["name"] as? String,
                    createdAt: session.user.createdAt.ISO8601Format()
                ),
                token: session.accessToken,
                refreshToken: session.refreshToken
            ),
            error: nil
        )
    }
    
    // Sign up with email/password
    func signUp(email: String, password: String, name: String?) async throws -> AuthResponse {
        var metadata: [String: AnyJSON] = [:]
        if let name = name {
            metadata["name"] = AnyJSON.string(name)
        }
        
        // Supabase returns AuthResponse with optional session
        let supabaseAuthResponse = try await client.auth.signUp(
            email: email,
            password: password,
            data: metadata
        )
        
        // Unwrap the optional session
        guard let session = supabaseAuthResponse.session else {
            throw NSError(domain: "Sign up failed - no session returned", code: -1)
        }
        
        // Save tokens from Session
        KeychainService.shared.save(session.accessToken, forKey: Constants.Keychain.accessToken)
        KeychainService.shared.save(session.refreshToken, forKey: Constants.Keychain.refreshToken)
        KeychainService.shared.save(session.user.id.uuidString, forKey: Constants.Keychain.userId)
        
        // Convert to our AuthResponse model
        return AuthResponse(
            success: true,
            data: AuthData(
                user: User(
                    id: session.user.id.uuidString,
                    email: session.user.email ?? "",
                    name: name,
                    createdAt: session.user.createdAt.ISO8601Format()
                ),
                token: session.accessToken,
                refreshToken: session.refreshToken
            ),
            error: nil
        )
    }
    
    // Sign in with Google
    func signInWithGoogle() async throws -> URL {
        let provider = Provider.google
        let url = try await client.auth.getOAuthSignInURL(
            provider: provider,
            redirectTo: URL(string: "kreativekoala.scribeai://auth/callback")
        )
        return url
    }
    
    // Sign in with Apple
    func signInWithApple(idToken: String, nonce: String) async throws -> AuthResponse {
        // Supabase returns Session directly
        let session = try await client.auth.signInWithIdToken(
            credentials: OpenIDConnectCredentials(
                provider: .apple,
                idToken: idToken,
                nonce: nonce
            )
        )
        
        // Save tokens from Session
        KeychainService.shared.save(session.accessToken, forKey: Constants.Keychain.accessToken)
        KeychainService.shared.save(session.refreshToken, forKey: Constants.Keychain.refreshToken)
        KeychainService.shared.save(session.user.id.uuidString, forKey: Constants.Keychain.userId)
        
        // Convert to our AuthResponse model
        return AuthResponse(
            success: true,
            data: AuthData(
                user: User(
                    id: session.user.id.uuidString,
                    email: session.user.email ?? "",
                    name: session.user.userMetadata["full_name"] as? String,
                    createdAt: session.user.createdAt.ISO8601Format()
                ),
                token: session.accessToken,
                refreshToken: session.refreshToken
            ),
            error: nil
        )
    }
    
    // Handle OAuth callback
    func handleOAuthCallback(url: URL) async throws -> AuthResponse {
        // Supabase returns Session directly
        let session = try await client.auth.session(from: url)
        
        // Save tokens from Session
        KeychainService.shared.save(session.accessToken, forKey: Constants.Keychain.accessToken)
        KeychainService.shared.save(session.refreshToken, forKey: Constants.Keychain.refreshToken)
        KeychainService.shared.save(session.user.id.uuidString, forKey: Constants.Keychain.userId)
        
        // Convert to our AuthResponse model
        return AuthResponse(
            success: true,
            data: AuthData(
                user: User(
                    id: session.user.id.uuidString,
                    email: session.user.email ?? "",
                    name: session.user.userMetadata["name"] as? String,
                    createdAt: session.user.createdAt.ISO8601Format()
                ),
                token: session.accessToken,
                refreshToken: session.refreshToken
            ),
            error: nil
        )
    }
    
    // Sign out
    func signOut() async throws {
        try await client.auth.signOut()
        KeychainService.shared.clear()
    }
    
    // Get current session
    func getCurrentSession() async throws -> Session? {
        return try await client.auth.session
    }
    
    // Refresh session
    func refreshSession() async throws -> Session {
        return try await client.auth.refreshSession()
    }
}
