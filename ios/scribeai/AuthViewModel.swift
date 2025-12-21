//
//  AuthViewModel.swift
//  scribeai
//
//  Updated with TokenManager integration
//

import SwiftUI
import AuthenticationServices
import CryptoKit
import GoogleSignIn

@MainActor
class AuthViewModel: NSObject, ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private var currentNonce: String?
    
    override init() {
        super.init()
        checkAuthStatus()
    }
    
    func checkAuthStatus() {
        // Use TokenManager to check for valid token
        Task {
            if let _ = await TokenManager.shared.getValidToken() {
                isAuthenticated = true
                
                // Try to get current session
                do {
                    if let session = try await SupabaseManager.shared.getCurrentSession() {
                        self.currentUser = User(
                            id: session.user.id.uuidString,
                            email: session.user.email ?? "",
                            name: session.user.userMetadata["name"] as? String,
                            createdAt: session.user.createdAt.ISO8601Format()
                        )
                    }
                } catch {
                    print("Failed to get session: \(error)")
                    // Token might be invalid, sign out
                    self.signOut()
                }
            } else {
                isAuthenticated = false
            }
        }
    }
    
    // Email/Password Sign In
    func signIn(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await SupabaseManager.shared.signIn(email: email, password: password)
            
            if response.success, let data = response.data {
                self.currentUser = data.user
                self.isAuthenticated = true
            } else {
                self.errorMessage = response.error ?? "Sign in failed"
            }
        } catch {
            self.errorMessage = error.localizedDescription
            ErrorReportingService.shared.reportError(flow: .signIn, error: error)
        }

        isLoading = false
    }

    func deleteAccount() async throws {
            print("🗑️ Starting account deletion...")
            
            guard let token = await TokenManager.shared.getValidToken() else {
                throw AccountDeletionError.notAuthenticated
            }
            
            // Call backend to delete all user data
            try await APIService.shared.deleteUserAccount(token: token)
            
            print("✅ Backend data deleted")
            
            // Sign out and clear local data
            do {
                try await SupabaseManager.shared.signOut()
            } catch {
                print("⚠️ Supabase sign out error (continuing anyway): \(error)")
            }
            
            // Clear all local data
            await MainActor.run {
                TokenManager.shared.clearTokens()
                self.isAuthenticated = false
                self.currentUser = nil
                print("✅ Account deleted successfully")
            }
        }
    
    // Email/Password Sign Up
    func signUp(email: String, password: String, name: String?) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await SupabaseManager.shared.signUp(
                email: email,
                password: password,
                name: name
            )
            
            if response.success, let data = response.data {
                self.currentUser = data.user
                self.isAuthenticated = true
            } else {
                self.errorMessage = response.error ?? "Sign up failed"
            }
        } catch {
            self.errorMessage = error.localizedDescription
            ErrorReportingService.shared.reportError(flow: .signUp, error: error)
        }

        isLoading = false
    }

    // Google Sign In - Web-based flow through Supabase
    func signInWithGoogle() async {
        isLoading = true
        errorMessage = nil
        
        do {
            let url = try await SupabaseManager.shared.signInWithGoogle()
            
            // Open URL in Safari/WebView
            await MainActor.run {
                UIApplication.shared.open(url)
            }
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to start Google Sign-In: \(error.localizedDescription)"
                self.isLoading = false
                ErrorReportingService.shared.reportError(flow: .signInWithGoogle, error: error)
            }
        }
    }
    
    // Apple Sign In - Request
    func signInWithApple() {
        print("🍎 Starting Apple Sign-In")
        let nonce = randomNonceString()
        currentNonce = nonce
        
        let appleIDProvider = ASAuthorizationAppleIDProvider()
        let request = appleIDProvider.createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = sha256(nonce)
        
        let authorizationController = ASAuthorizationController(authorizationRequests: [request])
        authorizationController.delegate = self
        authorizationController.presentationContextProvider = self
        authorizationController.performRequests()
    }
    
    // Handle OAuth Callback
    func handleOAuthCallback(url: URL) async {
        print("🔄 Starting OAuth callback handling")
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await SupabaseManager.shared.handleOAuthCallback(url: url)
            print("✅ OAuth callback successful")
            
            if response.success, let data = response.data {
                self.currentUser = data.user
                self.isAuthenticated = true
                print("✅ User authenticated: \(data.user.email)")
            } else {
                self.errorMessage = response.error ?? "Authentication failed"
                print("❌ Authentication failed: \(response.error ?? "unknown")")
            }
        } catch {
            self.errorMessage = error.localizedDescription
            print("❌ OAuth callback error: \(error)")
        }
        
        isLoading = false
        print("🔄 OAuth callback handling complete")
    }
    
    // Sign Out
    func signOut() {
        Task {
            do {
                try await SupabaseManager.shared.signOut()
            } catch {
                print("Sign out error: \(error)")
            }
            
            // Always clear local state even if Supabase signout fails
            await MainActor.run {
                TokenManager.shared.clearTokens()  // ✅ Use TokenManager
                self.isAuthenticated = false
                self.currentUser = nil
                print("✅ User signed out")
            }
        }
    }
    
    // Generate random nonce for Apple Sign In
    private func randomNonceString(length: Int = 32) -> String {
        precondition(length > 0)
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length
        
        while remainingLength > 0 {
            let randoms: [UInt8] = (0 ..< 16).map { _ in
                var random: UInt8 = 0
                let errorCode = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
                if errorCode != errSecSuccess {
                    fatalError("Unable to generate nonce. SecRandomCopyBytes failed with OSStatus \(errorCode)")
                }
                return random
            }
            
            randoms.forEach { random in
                if remainingLength == 0 {
                    return
                }
                
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }
        
        return result
    }
    
    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        let hashString = hashedData.compactMap {
            String(format: "%02x", $0)
        }.joined()
        
        return hashString
    }
}

enum AccountDeletionError: LocalizedError {
    case notAuthenticated
    case serverError(String)
    case networkError
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "You must be signed in to delete your account."
        case .serverError(let message):
            return message
        case .networkError:
            return "Network error. Please check your connection and try again."
        }
    }
}

// MARK: - ASAuthorizationControllerDelegate
extension AuthViewModel: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        print("🍎 Apple authorization received")
        
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            print("❌ Not an Apple ID credential")
            errorMessage = "Invalid credential type"
            return
        }
        
        guard let nonce = currentNonce else {
            print("❌ No nonce available")
            errorMessage = "Invalid state: missing nonce"
            return
        }
        
        guard let appleIDToken = appleIDCredential.identityToken else {
            print("❌ Unable to fetch identity token")
            errorMessage = "Unable to fetch identity token"
            return
        }
        
        guard let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
            print("❌ Unable to serialize token string from data")
            errorMessage = "Unable to serialize token"
            return
        }
        
        print("✅ Got Apple ID token")
        print("📧 Email: \(appleIDCredential.email ?? "not provided")")
        print("👤 Full Name: \(appleIDCredential.fullName?.givenName ?? "not provided")")
        
        Task {
            isLoading = true
            
            do {
                print("🔄 Sending to Supabase...")
                let response = try await SupabaseManager.shared.signInWithApple(
                    idToken: idTokenString,
                    nonce: nonce
                )
                
                print("✅ Supabase response received")
                
                if response.success, let data = response.data {
                    self.currentUser = data.user
                    self.isAuthenticated = true
                    print("✅ User authenticated: \(data.user.email)")
                } else {
                    self.errorMessage = response.error ?? "Apple Sign In failed"
                    print("❌ Authentication failed: \(response.error ?? "unknown")")
                }
            } catch {
                self.errorMessage = error.localizedDescription
                print("❌ Supabase error: \(error)")
                ErrorReportingService.shared.reportError(flow: .signInWithApple, error: error)
            }

            isLoading = false
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        print("❌ Apple Sign-In error: \(error)")
        print("❌ Error code: \((error as NSError).code)")
        print("❌ Error domain: \((error as NSError).domain)")

        // Error 1000 is user cancellation or configuration issue
        if (error as NSError).code == 1000 {
            errorMessage = "Apple Sign-In cancelled or not properly configured. Please check your Apple Developer settings."
        } else {
            errorMessage = "Apple Sign In failed: \(error.localizedDescription)"
            ErrorReportingService.shared.reportError(flow: .signInWithApple, error: error)
        }
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding
extension AuthViewModel: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        print("🪟 Getting presentation anchor")
        
        // Try to get the active window scene
        if let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
           let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first {
            print("✅ Found active window")
            return window
        }
        
        // Fallback to key window
        if let keyWindow = UIApplication.shared.windows.first(where: { $0.isKeyWindow }) {
            print("✅ Found key window")
            return keyWindow
        }
        
        // Fallback to any window
        if let anyWindow = UIApplication.shared.windows.first {
            print("⚠️ Using first available window")
            return anyWindow
        }
        
        // This should never happen in production, but handle it gracefully
        print("❌ No window found - creating temporary window")
        let temporaryWindow = UIWindow(frame: UIScreen.main.bounds)
        temporaryWindow.makeKeyAndVisible()
        return temporaryWindow
    }
}
