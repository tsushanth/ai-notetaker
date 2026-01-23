//
//  SubscriptionSettingsSection.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/29/25.
//


//
//  SubscriptionSettingsView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati
//  Settings section for subscription management
//

import SwiftUI
import StoreKit

struct SubscriptionSettingsSection: View {
    @StateObject private var storeManager = StoreKitManager.shared
    @State private var showingPaywall = false
    @State private var showingManageSubscription = false
    
    var body: some View {
        Section {
            // Current Status
            if storeManager.isSubscribed {
                subscribedContent
            } else {
                notSubscribedContent
            }
        } header: {
            Text("Subscription")
        }
        .sheet(isPresented: $showingPaywall) {
            NavigationView {
                PaywallView(source: "settings_section") {
                    showingPaywall = false
                }
            }
        }
        .manageSubscriptionsSheet(isPresented: $showingManageSubscription)
    }
    
    // MARK: - Subscribed Content
    
    private var subscribedContent: some View {
        VStack(spacing: 0) {
            // Status Row
            HStack {
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
            .padding(.vertical, 8)
            
            Divider()
                .background(Color.darkSurfaceVariant)
            
            // Manage Subscription Button
            Button(action: { showingManageSubscription = true }) {
                HStack {
                    Text("Manage Subscription")
                        .font(.system(size: 15))
                        .foregroundColor(.textPrimary)
                    
                    Spacer()
                    
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textTertiary)
                }
                .padding(.vertical, 12)
            }
        }
    }
    
    // MARK: - Not Subscribed Content

    private var notSubscribedContent: some View {
        Button(action: {
            AnalyticsService.shared.trackPaywallViewed(source: "settings_section")
            showingPaywall = true
        }) {
            HStack {
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
            .padding(.vertical, 8)
        }
    }
    
    // MARK: - Helpers
    
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
}

// MARK: - Subscription Banner (For Home Screen)

struct SubscriptionBanner: View {
    @StateObject private var storeManager = StoreKitManager.shared
    @State private var showingPaywall = false

    var body: some View {
        if !storeManager.isSubscribed {
            Button(action: {
                AnalyticsService.shared.trackPaywallViewed(source: "home_banner")
                showingPaywall = true
            }) {
                HStack(spacing: 12) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 24))
                        .foregroundColor(.purple80)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Upgrade to Premium")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.textPrimary)
                        
                        Text("Unlimited notes & AI features")
                            .font(.system(size: 13))
                            .foregroundColor(.textSecondary)
                    }
                    
                    Spacer()
                    
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textTertiary)
                }
                .padding(16)
                .background(
                    LinearGradient(
                        colors: [Color.purple80.opacity(0.15), Color.purple80.opacity(0.05)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .cornerRadius(16)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.purple80.opacity(0.3), lineWidth: 1)
                )
            }
            .buttonStyle(PlainButtonStyle())
            .sheet(isPresented: $showingPaywall) {
                NavigationView {
                    PaywallView(source: "home_banner") {
                        showingPaywall = false
                    }
                }
            }
        }
    }
}

// MARK: - Premium Badge

struct PremiumBadge: View {
    @StateObject private var storeManager = StoreKitManager.shared
    
    var body: some View {
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
        }
    }
}

// MARK: - Feature Gate Helper

struct PremiumFeatureGate<Content: View>: View {
    @StateObject private var storeManager = StoreKitManager.shared
    @State private var showingPaywall = false
    
    let content: () -> Content
    let lockedMessage: String
    
    init(lockedMessage: String = "Premium feature", @ViewBuilder content: @escaping () -> Content) {
        self.lockedMessage = lockedMessage
        self.content = content
    }
    
    var body: some View {
        if storeManager.isSubscribed {
            content()
        } else {
            Button(action: {
                AnalyticsService.shared.trackPaywallViewed(source: "premium_feature_gate")
                showingPaywall = true
            }) {
                HStack {
                    Image(systemName: "lock.fill")
                        .foregroundColor(.textTertiary)
                    Text(lockedMessage)
                        .foregroundColor(.textSecondary)
                    Spacer()
                    Text("Upgrade")
                        .foregroundColor(.purple80)
                        .font(.system(size: 14, weight: .medium))
                }
                .padding()
                .background(Color.cardBackground)
                .cornerRadius(12)
            }
            .sheet(isPresented: $showingPaywall) {
                NavigationView {
                    PaywallView(source: "premium_feature_gate") {
                        showingPaywall = false
                    }
                }
            }
        }
    }
}

// MARK: - Preview

#Preview("Settings Section") {
    List {
        SubscriptionSettingsSection()
    }
    .listStyle(.insetGrouped)
    .background(Color.darkBackground)
}

#Preview("Banner") {
    VStack {
        SubscriptionBanner()
            .padding()
    }
    .background(Color.darkBackground)
}
