//
//  ThemeManager.swift
//  scribeai
//
//  Manages app-wide theme (light/dark mode) preference
//

import SwiftUI

enum AppTheme: String, CaseIterable {
    case system = "system"
    case light = "light"
    case dark = "dark"

    var displayName: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var icon: String {
        switch self {
        case .system: return "iphone"
        case .light: return "sun.max.fill"
        case .dark: return "moon.fill"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

class ThemeManager: ObservableObject {
    static let shared = ThemeManager()

    private let themeKey = "app_theme"

    @Published var currentTheme: AppTheme {
        didSet {
            UserDefaults.standard.set(currentTheme.rawValue, forKey: themeKey)
        }
    }

    var colorScheme: ColorScheme? {
        currentTheme.colorScheme
    }

    private init() {
        let savedTheme = UserDefaults.standard.string(forKey: themeKey) ?? AppTheme.dark.rawValue
        self.currentTheme = AppTheme(rawValue: savedTheme) ?? .dark
    }

    func setTheme(_ theme: AppTheme) {
        currentTheme = theme
    }
}

// MARK: - Theme Selection Sheet

struct ThemeSelectionSheet: View {
    @ObservedObject var themeManager = ThemeManager.shared
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    Text("Choose how the app looks")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(spacing: 0) {
                        ForEach(AppTheme.allCases, id: \.self) { theme in
                            Button(action: {
                                themeManager.setTheme(theme)
                            }) {
                                HStack(spacing: 16) {
                                    Image(systemName: theme.icon)
                                        .font(.system(size: 20))
                                        .foregroundColor(.purple80)
                                        .frame(width: 24)

                                    Text(theme.displayName)
                                        .font(.system(size: 16))
                                        .foregroundColor(.textPrimary)

                                    Spacer()

                                    if themeManager.currentTheme == theme {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 16, weight: .semibold))
                                            .foregroundColor(.purple80)
                                    }
                                }
                                .padding(.horizontal, 20)
                                .padding(.vertical, 16)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PlainButtonStyle())

                            if theme != AppTheme.allCases.last {
                                Divider()
                                    .background(Color.darkSurfaceVariant)
                                    .padding(.leading, 60)
                            }
                        }
                    }
                    .background(Color.cardBackground)
                    .cornerRadius(12)
                    .padding(.horizontal, 16)

                    Spacer()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Appearance")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.textPrimary)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.purple80)
                }
            }
        }
        .preferredColorScheme(themeManager.colorScheme)
    }
}

#Preview {
    ThemeSelectionSheet()
}
