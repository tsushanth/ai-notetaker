//
//  SignUpView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//  FIXED: Added password visibility toggle (eye button)
//  FIXED: White border on scroll issue
//

import SwiftUI

struct SignUpView: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var authViewModel: AuthViewModel
    
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var passwordsMatch = true
    @State private var showPassword = false          // FIX: Password visibility
    @State private var showConfirmPassword = false   // FIX: Confirm password visibility
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 24) {
                        Spacer()
                            .frame(height: 40)
                        
                        // Title
                        VStack(spacing: 8) {
                            Text("Create Account")
                                .font(.system(size: 28, weight: .bold))
                                .foregroundColor(.textPrimary)
                            
                            Text("Join ScribeAI to start taking smart notes")
                                .font(.system(size: 14))
                                .foregroundColor(.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.bottom, 16)
                        
                        // Form Fields
                        VStack(spacing: 16) {
                            // Name
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Name")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.textSecondary)
                                
                                TextField("", text: $name)
                                    .placeholder(when: name.isEmpty) {
                                        Text("Enter your name")
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
                            
                            // Password - FIX: Added eye button for visibility toggle
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Password")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.textSecondary)
                                
                                HStack {
                                    if showPassword {
                                        TextField("", text: $password)
                                            .placeholder(when: password.isEmpty) {
                                                Text("Create a password")
                                                    .foregroundColor(.textTertiary)
                                            }
                                            .foregroundColor(.textPrimary)
                                            .textInputAutocapitalization(.never)
                                            .autocorrectionDisabled()
                                    } else {
                                        SecureField("", text: $password)
                                            .placeholder(when: password.isEmpty) {
                                                Text("Create a password")
                                                    .foregroundColor(.textTertiary)
                                            }
                                            .foregroundColor(.textPrimary)
                                    }
                                    
                                    Button(action: {
                                        showPassword.toggle()
                                    }) {
                                        Image(systemName: showPassword ? "eye.slash.fill" : "eye.fill")
                                            .foregroundColor(.textSecondary)
                                            .frame(width: 24, height: 24)
                                    }
                                }
                                .padding()
                                .background(Color.cardBackground)
                                .cornerRadius(12)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.darkSurfaceVariant, lineWidth: 1)
                                )
                                .onChange(of: password) { _ in
                                    checkPasswordsMatch()
                                }
                            }
                            
                            // Confirm Password - FIX: Added eye button for visibility toggle
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Confirm Password")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.textSecondary)
                                
                                HStack {
                                    if showConfirmPassword {
                                        TextField("", text: $confirmPassword)
                                            .placeholder(when: confirmPassword.isEmpty) {
                                                Text("Confirm your password")
                                                    .foregroundColor(.textTertiary)
                                            }
                                            .foregroundColor(.textPrimary)
                                            .textInputAutocapitalization(.never)
                                            .autocorrectionDisabled()
                                    } else {
                                        SecureField("", text: $confirmPassword)
                                            .placeholder(when: confirmPassword.isEmpty) {
                                                Text("Confirm your password")
                                                    .foregroundColor(.textTertiary)
                                            }
                                            .foregroundColor(.textPrimary)
                                    }
                                    
                                    Button(action: {
                                        showConfirmPassword.toggle()
                                    }) {
                                        Image(systemName: showConfirmPassword ? "eye.slash.fill" : "eye.fill")
                                            .foregroundColor(.textSecondary)
                                            .frame(width: 24, height: 24)
                                    }
                                }
                                .padding()
                                .background(Color.cardBackground)
                                .cornerRadius(12)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(
                                            !passwordsMatch ? Color.accentRed : Color.darkSurfaceVariant,
                                            lineWidth: 1
                                        )
                                )
                                .onChange(of: confirmPassword) { _ in
                                    checkPasswordsMatch()
                                }
                                
                                if !passwordsMatch && !confirmPassword.isEmpty {
                                    Text("Passwords don't match")
                                        .font(.system(size: 12))
                                        .foregroundColor(.accentRed)
                                }
                            }
                        }
                        .padding(.horizontal, 24)
                        
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
                            .padding(.horizontal, 24)
                        }
                        
                        // Sign Up Button
                        Button(action: {
                            Task {
                                await authViewModel.signUp(
                                    email: email,
                                    password: password,
                                    name: name.isEmpty ? nil : name
                                )
                                
                                if authViewModel.isAuthenticated {
                                    dismiss()
                                }
                            }
                        }) {
                            HStack {
                                if authViewModel.isLoading {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Text("Create Account")
                                        .font(.system(size: 16, weight: .semibold))
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(
                                (authViewModel.isLoading ||
                                 email.isEmpty ||
                                 password.isEmpty ||
                                 !passwordsMatch ||
                                 password.count < 6) ? Color.purple80.opacity(0.5) : Color.purple80
                            )
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(
                            authViewModel.isLoading ||
                            email.isEmpty ||
                            password.isEmpty ||
                            !passwordsMatch ||
                            password.count < 6
                        )
                        .padding(.horizontal, 24)
                        
                        // Password Requirements
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Password must:")
                                .font(.system(size: 12))
                                .foregroundColor(.textSecondary)
                            
                            HStack(spacing: 4) {
                                Image(systemName: password.count >= 6 ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(password.count >= 6 ? .green : .textTertiary)
                                    .font(.system(size: 12))
                                Text("Be at least 6 characters")
                                    .font(.system(size: 12))
                                    .foregroundColor(.textTertiary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        
                        Spacer()
                            .frame(height: 50)
                    }
                }
                // FIX: Prevent white border by ensuring scroll view has proper background
                .modifier(HideScrollBackgroundModifier())
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        dismiss()
                    }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.textSecondary)
                    }
                }
            }
        }
        .navigationViewStyle(.stack)
        // FIX: Force dark mode to prevent any light mode flashes
        .preferredColorScheme(.dark)
    }

    private func checkPasswordsMatch() {
        passwordsMatch = confirmPassword.isEmpty || password == confirmPassword
    }
}

// MARK: - iOS Version Compatible Modifier

struct HideScrollBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.0, *) {
            content
                .scrollContentBackground(.hidden)
        } else {
            content
                .onAppear {
                    // For iOS 15, we need to modify UITableView appearance
                    UITableView.appearance().backgroundColor = .clear
                }
        }
    }
}

#Preview {
    SignUpView()
        .environmentObject(AuthViewModel())
}
