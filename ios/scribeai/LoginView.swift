import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @State private var email = ""
    @State private var password = ""
    @State private var showingSignUp = false

    var body: some View {
        NavigationView {
            GeometryReader { geometry in
                ZStack {
                    Color.darkBackground
                        .ignoresSafeArea()

                    ScrollView {
                        VStack(spacing: 0) {
                            Spacer()
                                .frame(height: max(40, geometry.size.height * 0.08))

                            VStack(spacing: 32) {
                                // Logo & Title
                                VStack(spacing: 16) {
                                    Image(systemName: "doc.text.fill")
                                        .font(.system(size: 60))
                                        .foregroundColor(.purple80)

                                    Text("scribe ai")
                                        .font(.system(size: 32, weight: .bold))
                                        .foregroundColor(.textPrimary)

                                    Text("Your AI-powered note-taking companion")
                                        .font(.system(size: 14))
                                        .foregroundColor(.textSecondary)
                                        .multilineTextAlignment(.center)
                                }
                                .padding(.bottom, 16)

                                // Email & Password Fields
                                VStack(spacing: 16) {
                                    // Email
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("Email")
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundColor(.textSecondary)

                                        TextField("", text: $email)
                                            .placeholder(when: email.isEmpty) {
                                                Text("Enter your email")
                                                    .foregroundColor(.textTertiary)
                                            }
                                            .textInputAutocapitalization(.never)
                                            .keyboardType(.emailAddress)
                                            .autocorrectionDisabled()
                                            .padding()
                                            .background(Color.cardBackground)
                                            .foregroundColor(.textPrimary)
                                            .cornerRadius(12)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 12)
                                                    .stroke(Color.darkSurfaceVariant, lineWidth: 1)
                                            )
                                    }

                                    // Password
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("Password")
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundColor(.textSecondary)

                                        SecureField("", text: $password)
                                            .placeholder(when: password.isEmpty) {
                                                Text("Enter your password")
                                                    .foregroundColor(.textTertiary)
                                            }
                                            .padding()
                                            .background(Color.cardBackground)
                                            .foregroundColor(.textPrimary)
                                            .cornerRadius(12)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 12)
                                                    .stroke(Color.darkSurfaceVariant, lineWidth: 1)
                                            )
                                    }
                                }

                                // Error Message
                                if let error = authViewModel.errorMessage {
                                    HStack {
                                        Image(systemName: "exclamationmark.circle.fill")
                                            .foregroundColor(.accentRed)
                                        Text(error)
                                            .font(.system(size: 13))
                                            .foregroundColor(.accentRed)
                                    }
                                    .padding()
                                    .background(Color.accentRed.opacity(0.1))
                                    .cornerRadius(12)
                                }

                                // Login Button
                                Button(action: {
                                    Task {
                                        await authViewModel.signIn(email: email, password: password)
                                    }
                                }) {
                                    HStack {
                                        if authViewModel.isLoading {
                                            ProgressView()
                                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                        } else {
                                            Text("Sign In")
                                                .font(.system(size: 16, weight: .semibold))
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 56)
                                    .background(Color.purple80)
                                    .foregroundColor(.white)
                                    .cornerRadius(12)
                                }
                                .disabled(authViewModel.isLoading || email.isEmpty || password.isEmpty)

                                // Divider
                                HStack {
                                    Rectangle()
                                        .frame(height: 1)
                                        .foregroundColor(.darkSurfaceVariant)

                                    Text("OR")
                                        .font(.system(size: 12))
                                        .foregroundColor(.textTertiary)
                                        .padding(.horizontal, 16)

                                    Rectangle()
                                        .frame(height: 1)
                                        .foregroundColor(.darkSurfaceVariant)
                                }

                                // Social Sign In Buttons
                                VStack(spacing: 12) {
                                    // Apple Sign In
                                    Button(action: {
                                        authViewModel.signInWithApple()
                                    }) {
                                        HStack(spacing: 8) {
                                            Image(systemName: "applelogo")
                                                .font(.system(size: 20))
                                            Text("Continue with Apple")
                                                .font(.system(size: 16, weight: .medium))
                                        }
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 56)
                                        .background(Color.white)
                                        .foregroundColor(.black)
                                        .cornerRadius(12)
                                    }

                                    // Google Sign In
                                    Button(action: {
                                        Task {
                                            await authViewModel.signInWithGoogle()
                                        }
                                    }) {
                                        HStack {
                                            Image(systemName: "globe")
                                                .font(.system(size: 20))
                                            Text("Continue with Google")
                                                .font(.system(size: 16, weight: .medium))
                                        }
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 56)
                                        .background(Color.cardBackground)
                                        .foregroundColor(.textPrimary)
                                        .cornerRadius(12)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(Color.darkSurfaceVariant, lineWidth: 1)
                                        )
                                    }
                                }

                                // Sign Up Link
                                Button(action: {
                                    showingSignUp = true
                                }) {
                                    HStack(spacing: 4) {
                                        Text("Don't have an account?")
                                            .foregroundColor(.textSecondary)
                                        Text("Sign Up")
                                            .foregroundColor(.purple80)
                                            .fontWeight(.semibold)
                                    }
                                    .font(.system(size: 14))
                                }
                                .padding(.top, 8)

                                Spacer()
                                    .frame(height: max(40, geometry.size.height * 0.08))
                            }
                            .frame(maxWidth: 480)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 24)
                        }
                        .frame(minHeight: geometry.size.height)
                    }
                }
            }
            .sheet(isPresented: $showingSignUp) {
                SignUpView()
            }
        }
        .navigationViewStyle(.stack)
    }
}

// Helper for placeholder
extension View {
    func placeholder<Content: View>(
        when shouldShow: Bool,
        alignment: Alignment = .leading,
        @ViewBuilder placeholder: () -> Content) -> some View {

        ZStack(alignment: alignment) {
            placeholder().opacity(shouldShow ? 1 : 0)
            self
        }
    }
}
