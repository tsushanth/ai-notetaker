//
//  ProfileView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//  Updated with Account Deletion (Apple requirement 5.1.1)
//  Updated with Subscription Management
//  Updated with Language Selection
//  FIXED: Language selection header visibility
//  FIXED: Light mode flash during dark mode
//

import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var authViewModel: AuthViewModel
    @StateObject private var storeManager = StoreKitManager.shared
    @Environment(\.dismiss) var dismiss
    @State private var showingSignOutAlert = false
    @State private var showingAboutAlert = false
    @State private var showingDeleteAccountAlert = false
    @State private var showingDeleteConfirmation = false
    @State private var isDeletingAccount = false
    @State private var deleteError: String?
    @State private var showingPaywall = false
    @State private var showingLanguageSheet = false
    @State private var selectedLanguage: String = UserDefaults.standard.string(forKey: "preferred_language") ?? "english"
    
    private let languages: [(code: String, name: String)] = [
        // Major World Languages
        ("english", "English"),
        ("spanish", "Spanish"),
        ("french", "French"),
        ("german", "German"),
        ("portuguese", "Portuguese"),
        ("italian", "Italian"),
        ("chinese", "Chinese (Simplified)"),
        ("chinese_traditional", "Chinese (Traditional)"),
        ("japanese", "Japanese"),
        ("korean", "Korean"),

        // South Asian Languages
        ("hindi", "Hindi"),
        ("bengali", "Bengali"),
        ("tamil", "Tamil"),
        ("telugu", "Telugu"),
        ("urdu", "Urdu"),
        ("marathi", "Marathi"),
        ("gujarati", "Gujarati"),
        ("punjabi", "Punjabi"),

        // European Languages
        ("dutch", "Dutch"),
        ("polish", "Polish"),
        ("russian", "Russian"),
        ("ukrainian", "Ukrainian"),
        ("swedish", "Swedish"),
        ("norwegian", "Norwegian"),
        ("danish", "Danish"),
        ("finnish", "Finnish"),
        ("greek", "Greek"),
        ("czech", "Czech"),
        ("romanian", "Romanian"),
        ("hungarian", "Hungarian"),

        // Middle Eastern & African Languages
        ("arabic", "Arabic"),
        ("hebrew", "Hebrew"),
        ("turkish", "Turkish"),
        ("persian", "Persian (Farsi)"),
        ("swahili", "Swahili"),

        // Southeast Asian Languages
        ("thai", "Thai"),
        ("vietnamese", "Vietnamese"),
        ("indonesian", "Indonesian"),
        ("malay", "Malay"),
        ("tagalog", "Filipino (Tagalog)")
    ]
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 24) {
                        Spacer()
                            .frame(height: 32)
                        
                        // Profile Header
                        VStack(spacing: 16) {
                            ZStack(alignment: .bottomTrailing) {
                                Image(systemName: "person.circle.fill")
                                    .font(.system(size: 80))
                                    .foregroundColor(.purple80)
                                
                                // Premium Badge
                                if storeManager.isSubscribed {
                                    HStack(spacing: 4) {
                                        Image(systemName: "crown.fill")
                                            .font(.system(size: 10))
                                        Text("PRO")
                                            .font(.system(size: 10, weight: .bold))
                                    }
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(
                                        LinearGradient(
                                            colors: [Color.purple80, Color.purple80.opacity(0.8)],
                                            startPoint: .leading,
                                            endPoint: .trailing
                                        )
                                    )
                                    .cornerRadius(6)
                                    .offset(x: 8, y: 4)
                                }
                            }
                            
                            if let user = authViewModel.currentUser {
                                Text(user.name ?? "User")
                                    .font(.system(size: 24, weight: .bold))
                                    .foregroundColor(.textPrimary)
                                
                                Text(user.email)
                                    .font(.system(size: 14))
                                    .foregroundColor(.textSecondary)
                            }
                        }
                        .padding(.bottom, 16)
                        
                        // MARK: - Subscription Section
                        subscriptionSection
                        
                        // MARK: - Settings Section
                        VStack(spacing: 0) {
                            // Language Selection
                            ProfileRow(
                                icon: "globe",
                                title: "Language",
                                subtitle: languageDisplayName(for: selectedLanguage)
                            ) {
                                showingLanguageSheet = true
                            }
                            
                            Divider()
                                .background(Color.darkSurfaceVariant)
                                .padding(.leading, 56)
                            
                            ProfileRow(
                                icon: "questionmark.circle",
                                title: "Help & Support",
                                subtitle: "Get help with the app"
                            ) {
                                openHelpAndSupport()
                            }
                            
                            Divider()
                                .background(Color.darkSurfaceVariant)
                                .padding(.leading, 56)
                            
                            ProfileRow(
                                icon: "info.circle",
                                title: "About",
                                subtitle: "Version 1.0.0"
                            ) {
                                showingAboutAlert = true
                            }
                        }
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .padding(.horizontal, 24)
                        
                        // Sign Out Button
                        Button(action: {
                            showingSignOutAlert = true
                        }) {
                            HStack {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                Text("Sign Out")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.accentRed.opacity(0.1))
                            .foregroundColor(.accentRed)
                            .cornerRadius(12)
                        }
                        .padding(.horizontal, 24)
                        
                        // Delete Account Section
                        VStack(spacing: 0) {
                            Button(action: {
                                showingDeleteAccountAlert = true
                            }) {
                                HStack(spacing: 16) {
                                    Image(systemName: "trash")
                                        .font(.system(size: 20))
                                        .foregroundColor(.accentRed)
                                        .frame(width: 24)
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Delete Account")
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(.accentRed)
                                        
                                        Text("Permanently delete your account and data")
                                            .font(.system(size: 13))
                                            .foregroundColor(.textSecondary)
                                    }
                                    
                                    Spacer()
                                    
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 14))
                                        .foregroundColor(.textTertiary)
                                }
                                .padding()
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .padding(.horizontal, 24)
                        
                        Spacer()
                    }
                }
                
                // Loading overlay for account deletion
                if isDeletingAccount {
                    Color.black.opacity(0.5)
                        .ignoresSafeArea()
                    
                    VStack(spacing: 16) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(1.5)
                        
                        Text("Deleting account...")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.white)
                    }
                    .padding(32)
                    .background(Color.cardBackground)
                    .cornerRadius(16)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        dismiss()
                    }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.textPrimary)
                    }
                }
            }
        }
        // FIX: Force dark mode to prevent light mode flashes
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingPaywall) {
            NavigationView {
                PaywallView {
                    showingPaywall = false
                }
            }
            .preferredColorScheme(.dark)  // FIX: Ensure paywall is also dark
        }
        .sheet(isPresented: $showingLanguageSheet) {
            LanguageSelectionSheet(
                selectedLanguage: $selectedLanguage,
                languages: languages,
                onSave: {
                    UserDefaults.standard.set(selectedLanguage, forKey: "preferred_language")
                    showingLanguageSheet = false
                },
                onCancel: {
                    selectedLanguage = UserDefaults.standard.string(forKey: "preferred_language") ?? "english"
                    showingLanguageSheet = false
                }
            )
        }
        .alert("Sign Out", isPresented: $showingSignOutAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Sign Out", role: .destructive) {
                authViewModel.signOut()
                dismiss()
            }
        } message: {
            Text("Are you sure you want to sign out?")
        }
        .alert("About Scribe AI", isPresented: $showingAboutAlert) {
            Button("Visit Website", action: {
                if let url = URL(string: "https://sendsmiles.biz") {
                    UIApplication.shared.open(url)
                }
            })
            Button("Privacy Policy", action: {
                if let url = URL(string: "https://www.sendsmiles.biz/privacy-policy") {
                    UIApplication.shared.open(url)
                }
            })
            Button("Terms of Service", action: {
                if let url = URL(string: "https://www.sendsmiles.biz/terms-of-service") {
                    UIApplication.shared.open(url)
                }
            })
            Button("OK", role: .cancel) {}
        } message: {
            Text("Scribe AI - Your AI-powered study assistant\n\nVersion 1.0.0\n\n© 2024 Scribe AI. All rights reserved.")
        }
        // Delete Account Initial Alert
        .alert("Delete Account", isPresented: $showingDeleteAccountAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) {
                showingDeleteConfirmation = true
            }
        } message: {
            Text("Are you sure you want to delete your account? This will permanently delete:\n\n• Your profile and settings\n• All your notes and recordings\n• All generated content (quizzes, flashcards, podcasts)\n\nThis action cannot be undone.")
        }
        // Delete Account Final Confirmation
        .alert("Final Confirmation", isPresented: $showingDeleteConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Delete My Account", role: .destructive) {
                deleteAccount()
            }
        } message: {
            Text("This is your last chance. Once deleted, your account and all data cannot be recovered.\n\nAre you absolutely sure?")
        }
        // Delete Error Alert
        .alert("Error", isPresented: .init(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK", role: .cancel) {
                deleteError = nil
            }
        } message: {
            Text(deleteError ?? "An error occurred while deleting your account. Please try again or contact support.")
        }
        .navigationViewStyle(.stack)
    }
    
    private func languageDisplayName(for code: String) -> String {
        languages.first(where: { $0.code == code })?.name ?? "English"
    }
    
    // MARK: - Subscription Section
    
    @ViewBuilder
    private var subscriptionSection: some View {
        VStack(spacing: 0) {
            if storeManager.isSubscribed {
                // Subscribed State
                HStack(spacing: 16) {
                    ZStack {
                        Circle()
                            .fill(Color.accentGreen.opacity(0.2))
                            .frame(width: 44, height: 44)
                        
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.accentGreen)
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Premium")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.textPrimary)
                            
                            Text("ACTIVE")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.accentGreen)
                                .cornerRadius(4)
                        }
                        
                        if let productId = storeManager.currentSubscriptionProductId {
                            Text(subscriptionTypeText(for: productId))
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                        
                        if let expirationDate = storeManager.subscriptionExpirationDate {
                            Text("Renews \(expirationDate.formatted(date: .abbreviated, time: .omitted))")
                                .font(.system(size: 12))
                                .foregroundColor(.textTertiary)
                        }
                    }
                    
                    Spacer()
                }
                .padding()
                
                Divider()
                    .background(Color.darkSurfaceVariant)
                    .padding(.leading, 56)
                
                // Manage Subscription Button
                Button(action: openManageSubscriptions) {
                    HStack {
                        Text("Manage Subscription")
                            .font(.system(size: 15))
                            .foregroundColor(.textPrimary)
                        
                        Spacer()
                        
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.textTertiary)
                    }
                    .padding()
                    .contentShape(Rectangle())
                }
                .buttonStyle(PlainButtonStyle())
                
            } else {
                // Not Subscribed State
                Button(action: { showingPaywall = true }) {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(Color.purple80.opacity(0.2))
                                .frame(width: 44, height: 44)
                            
                            Image(systemName: "crown.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.purple80)
                        }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Upgrade to Premium")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.textPrimary)
                            
                            Text("Unlock all features")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                        
                        Spacer()
                        
                        Text("View Plans")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.purple80)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.purple80.opacity(0.15))
                            .cornerRadius(8)
                    }
                    .padding()
                    .contentShape(Rectangle())
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .background(Color.cardBackground)
        .cornerRadius(12)
        .padding(.horizontal, 24)
    }
    
    private func subscriptionTypeText(for productId: String) -> String {
        switch productId {
        case SubscriptionProduct.monthly.rawValue:
            return "Monthly Plan"
        case SubscriptionProduct.yearly.rawValue:
            return "Yearly Plan"
        default:
            return "Premium Plan"
        }
    }
    
    private func openManageSubscriptions() {
        if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
            UIApplication.shared.open(url)
        }
    }
    
    private func deleteAccount() {
        isDeletingAccount = true
        
        Task {
            do {
                try await authViewModel.deleteAccount()
                
                await MainActor.run {
                    isDeletingAccount = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isDeletingAccount = false
                    deleteError = error.localizedDescription
                }
            }
        }
    }
    
    private func openHelpAndSupport() {
        let alert = UIAlertController(
            title: "Help & Support",
            message: "How would you like to get help?",
            preferredStyle: .actionSheet
        )
        
        // Email Support
        alert.addAction(UIAlertAction(title: "Email Support", style: .default) { _ in
                let email = "puzzleverseai@gmail.com"
                let subject = "Scribe AI Support Request"
                
                if let mailtoURL = URL(string: "mailto:\(email)?subject=\(subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"),
                   UIApplication.shared.canOpenURL(mailtoURL) {
                    UIApplication.shared.open(mailtoURL)
                } else {
                    UIPasteboard.general.string = email
                    self.showEmailCopiedAlert()
                }
            })
        
        
        // Rate App
        alert.addAction(UIAlertAction(title: "Rate App", style: .default) { _ in
            if let url = URL(string: "https://apps.apple.com/app/id6755475602?action=write-review") {
                UIApplication.shared.open(url)
            }
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootViewController = windowScene.windows.first?.rootViewController {
            var topController = rootViewController
            while let presented = topController.presentedViewController {
                topController = presented
            }
            
            if let popover = alert.popoverPresentationController {
                popover.sourceView = topController.view
                popover.sourceRect = CGRect(x: topController.view.bounds.midX, y: topController.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            
            topController.present(alert, animated: true)
        }
    }
    
    private func showEmailCopiedAlert() {
        let alert = UIAlertController(
            title: "Email Copied",
            message: "Our support email (puzzleverseai@gmail.com) has been copied to your clipboard. Please paste it into your email app.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootViewController = windowScene.windows.first?.rootViewController {
            var topController = rootViewController
            while let presented = topController.presentedViewController {
                topController = presented
            }
            topController.present(alert, animated: true)
        }
    }
}

// MARK: - Language Selection Sheet (Extracted as separate view)
// FIX: Proper dark mode and visible header

struct LanguageSelectionSheet: View {
    @Binding var selectedLanguage: String
    let languages: [(code: String, name: String)]
    let onSave: () -> Void
    let onCancel: () -> Void
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // Subtitle
                    Text("AI-generated content will be in this language")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.darkBackground)
                    
                    // Language List - Using ScrollView instead of List for better dark mode control
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(languages, id: \.code) { language in
                                Button(action: {
                                    selectedLanguage = language.code
                                }) {
                                    HStack {
                                        Text(language.name)
                                            .font(.system(size: 16))
                                            .foregroundColor(.textPrimary)
                                        
                                        Spacer()
                                        
                                        if selectedLanguage == language.code {
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 16, weight: .semibold))
                                                .foregroundColor(.purple80)
                                        }
                                    }
                                    .padding(.horizontal, 20)
                                    .padding(.vertical, 14)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(PlainButtonStyle())
                                
                                if language.code != languages.last?.code {
                                    Divider()
                                        .background(Color.darkSurfaceVariant)
                                        .padding(.leading, 20)
                                }
                            }
                        }
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // FIX: Visible header in toolbar
                ToolbarItem(placement: .principal) {
                    Text("Select Language")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.textPrimary)
                }
                
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundColor(.textSecondary)
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        onSave()
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.purple80)
                }
            }
        }
        // FIX: Force dark mode on the sheet
        .preferredColorScheme(.dark)
    }
}

struct ProfileRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(.purple80)
                    .frame(width: 24)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.textPrimary)
                    
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(.textTertiary)
            }
            .padding()
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    ProfileView()
        .environmentObject(AuthViewModel())
}
